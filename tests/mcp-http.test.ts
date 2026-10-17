import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { Store } from '../src/core/store';
import { PluginService } from '../src/core/plugins';
import { HttpWorkspaces } from '../src/core/http-workspaces';
import { executeHttp } from '../src/core/http-transport';
import { ConnectionRegistry } from '../src/core/connections/registry';
import { ConnectionManager } from '../src/core/connections/manager';
import type { ProviderConnection } from '../src/core/connections/contracts';
import { McpService } from '../src/core/mcp';
import { newHttpRequest } from '../src/shared/http';

test('HTTP API binds workspace grants and API-owned senders, never borrows desktop sessions or falls back local', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cshell-api-http-'));
  const codec = {
    encrypt: async (v: string) => Buffer.from(v).toString('base64'),
    decrypt: async (v: string) => Buffer.from(v, 'base64').toString(),
  };
  const store = new Store(directory, codec);
  await store.load();
  await new PluginService(store).install('cshell.http');
  const profileId = randomUUID();
  await store.saveProfile({
    id: profileId,
    name: 'Sender fixture',
    host: 'fixture',
    port: 22,
    username: 'test',
    group: '',
    favorite: false,
    auth: 'password',
  });
  const sessions = new Map<string, ProviderConnection>();
  const usedSessions: string[] = [];
  const registry = new ConnectionRegistry((target) => ({ id: target.resourceId, group: '' }));
  const manager = new ConnectionManager(registry);
  manager.register({
    id: 'test.http',
    version: '1.0.0',
    configuration: z.unknown(),
    capabilities: [],
    async connect() {
      const id = randomUUID();
      sessions.set(id, {
        target: {
          providerId: 'test.http',
          resourceId: profileId,
          identity: 'fixed-fixture',
          label: 'Fixture sender',
        },
        tools: [],
        http: (request, signal) => {
          usedSessions.push(id);
          return executeHttp(request, signal);
        },
      });
      return id;
    },
    disconnect(id) {
      sessions.delete(id);
    },
    resolve(id) {
      const connection = sessions.get(id);
      if (!connection) throw new Error('Closed');
      return connection;
    },
  });
  const desktop = await manager.connect('test.http', {}, undefined, new AbortController().signal);
  let received = 0;
  let responseBody = Buffer.from('received');
  const server = createServer((_req, res) => {
    received++;
    res.end(responseBody);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
  const http = new HttpWorkspaces(directory, store, registry);
  await http.load();
  const workspaceId = await http.create('API workspace', '');
  const request = {
    ...newHttpRequest(),
    path: url,
    sender: profileId,
    headers: [{ name: 'Authorization', value: 'saved-secret', enabled: true }],
  };
  const workspace = http.workspace(workspaceId);
  workspace.requests.push(request);
  await http.save(workspace);
  const probe = createServer();
  await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((r) => probe.close(() => r()));
  const service = new McpService(store, directory, async () => true, {
    manager,
    http,
    connect: (_p, signal) => manager.connect('test.http', {}, undefined, signal),
  });
  try {
    await service.configure({
      enabled: true,
      port,
      allowedProfiles: [workspaceId, profileId],
      allowCommands: false,
      capabilities: [],
      targetPolicies: {
        [workspaceId]: {
          allowCommands: false,
          capabilities: ['http.use', 'http.send'],
          review: 'authorized',
        },
        [profileId]: { allowCommands: false, capabilities: ['http.send'], review: 'authorized' },
      },
      review: 'authorized',
    });
    const token = await service.accessToken();
    const call = async (name: string, args: object = {}) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/call`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Connection: 'close',
        },
        body: JSON.stringify({ name, arguments: args }),
      });
      return response.json();
    };
    const decode = (v: { result: { content: { text: string }[] } }) =>
      JSON.parse(v.result.content[0].text);
    const listing = await call('http_list');
    assert.deepEqual(decode(listing).senders, []);
    assert.ok(!JSON.stringify(listing).includes('saved-secret'));
    const args = { workspaceId, requestId: request.id };
    assert.equal((await call('http_send', args)).result.isError, true);
    assert.equal(received, 0);
    const apiSession = decode(await call('connect', { profileId })).sessionId;
    assert.notEqual(apiSession, desktop);
    const sent = decode(await call('http_send', args));
    assert.equal(sent.state, 'done');
    assert.deepEqual(usedSessions, [apiSession]);
    assert.equal(received, 1);
    responseBody = Buffer.concat([
      Buffer.from('完整响应😀'.repeat(6000)),
      Buffer.from([0, 255, 128]),
    ]);
    const large = decode(await call('http_send', args));
    assert.equal(large.response.previewTruncated, true);
    assert.equal(large.response.truncated, true);
    assert.equal(large.response.captureTruncated, false);
    const parts: Buffer[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const chunk = decode(
        await call('http_history', {
          workspaceId,
          historyId: large.id,
          offset,
          limitBytes: 8191,
        }),
      );
      assert.equal(chunk.offset, offset);
      assert.equal(chunk.encoding, 'base64');
      assert.equal(chunk.captureTruncated, false);
      const bytes = Buffer.from(chunk.body, 'base64');
      assert.ok(bytes.length <= 8191);
      parts.push(bytes);
      offset = chunk.nextOffset;
    }
    assert.deepEqual(
      Buffer.concat(parts),
      responseBody,
      'chunks preserve UTF-8 boundaries and binary bytes',
    );
    assert.equal(
      decode(
        await call('http_history', {
          workspaceId,
          historyId: large.id,
          offset: responseBody.length + 1,
        }),
      ).code,
      'INVALID_ARGUMENT',
    );
    const otherWorkspace = await http.create('Other workspace', '');
    assert.equal(
      decode(
        await call('http_history', {
          workspaceId: otherWorkspace,
          historyId: large.id,
        }),
      ).code,
      'FORBIDDEN',
    );
    assert.equal(received, 2, 'reading retained bytes must not resend requests');
    assert.equal((await call('http_send', { ...args, sender: 'local' })).result.isError, true);
    responseBody = Buffer.from('async');
    const asynchronous = { arguments: args, idempotencyKey: 'http-once' };
    const [first, second] = await Promise.all([
      call('http_task_start', asynchronous),
      call('http_task_start', asynchronous),
    ]);
    const taskId = decode(first).taskId;
    assert.ok(taskId);
    assert.equal(decode(second).taskId, taskId);
    let task;
    for (let i = 0; i < 100; i++) {
      task = decode(await call('task_read', { taskId }));
      if (task.settled) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(task.state, 'succeeded');
    assert.equal(received, 3, 'duplicate asynchronous submissions send only once');
    assert.equal(decode(await call('http_task_start', asynchronous)).taskId, taskId);
    await call('disconnect', { sessionId: apiSession });
    assert.equal((await call('http_send', args)).result.isError, true);
    assert.equal(received, 3, 'disconnected API sender must not fall back to desktop or local');
    const edited = http.workspace(workspaceId);
    edited.tools = edited.tools.filter((t) => t !== 'http_send');
    await http.save(edited);
    assert.equal((await call('http_send', args)).error.code, 'NOT_FOUND');
    await service.stop();
    assert.ok(manager.tools.describe(desktop));
  } finally {
    await service.stop();
    http.dispose();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(directory, { recursive: true, force: true, maxRetries: 5 });
  }
});
