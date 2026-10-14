import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { executeHttp } from '../src/core/http-transport';
import { HttpWorkspaces } from '../src/core/http-workspaces';
import { Store } from '../src/core/store';
import { PluginService } from '../src/core/plugins';
import { ConnectionRegistry } from '../src/core/connections/registry';
import { emptyAiPolicy } from '../src/shared/ai';
import { newHttpRequest, type HttpWireRequest } from '../src/shared/http';
import { ClientServer } from '../src/core/client/server';
import { ClientProvider } from '../src/core/client/provider';
import { ClientVault } from '../src/core/client/identity';
import type { ManagedProvider } from '../src/core/connections/manager';
import { AiService } from '../src/core/ai';

const codec = {
  encrypt: async (v: string) => Buffer.from(v).toString('base64'),
  decrypt: async (v: string) => Buffer.from(v, 'base64').toString(),
};
async function endpoint() {
  const requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(req.url!);
    if (req.url === '/slow') return;
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: '/unexpected' });
      res.end();
      return;
    }
    if (req.url === '/large') {
      res.end('x'.repeat(2_000_000));
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          method: req.method,
          url: req.url,
          body: Buffer.concat(chunks).toString(),
          secret: req.headers.authorization,
        }),
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    requests,
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}
test('HTTP sends exact bytes, preserves HTTP errors, does not follow redirects, bounds responses and cancels', async () => {
  const e = await endpoint();
  const input: HttpWireRequest = {
    url: e.url,
    method: 'POST',
    body: '中文 👋',
    headers: [],
    timeoutMs: 15000,
  };
  try {
    const response = await executeHttp(input, new AbortController().signal);
    assert.equal(JSON.parse(Buffer.from(response.body, 'base64').toString()).body, input.body);
    const redirect = await executeHttp(
      { ...input, url: e.url + '/redirect' },
      new AbortController().signal,
    );
    assert.equal(redirect.status, 302);
    assert.ok(!e.requests.includes('/unexpected'));
    const large = await executeHttp(
      { ...input, url: e.url + '/large' },
      new AbortController().signal,
    );
    assert.equal(large.bytes, 1024 * 1024);
    assert.equal(large.truncated, true);
    const abort = new AbortController();
    const pending = executeHttp({ ...input, url: e.url + '/slow' }, abort.signal);
    setTimeout(() => abort.abort(), 30);
    await assert.rejects(pending);
    await assert.rejects(
      executeHttp(
        { ...input, headers: [{ enabled: true, name: 'Host', value: 'other' }] },
        new AbortController().signal,
      ),
    );
    await assert.rejects(
      executeHttp(
        { ...input, headers: [{ enabled: true, name: 'X-Test', value: 'a\r\nb: c' }] },
        new AbortController().signal,
      ),
    );
    await assert.rejects(
      executeHttp({ ...input, url: 'file:///tmp/private' }, new AbortController().signal),
    );
  } finally {
    await e.close();
  }
});
test('HTTP workspace persistence, scopes, tool opt-out, saved credentials, revision conflicts and history', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cshell-http-')),
    e = await endpoint();
  const store = new Store(dir, codec);
  await store.load();
  const plugins = new PluginService(store);
  const registry = new ConnectionRegistry(() => undefined);
  const http = new HttpWorkspaces(dir, store, registry);
  await http.load();
  try {
    await assert.rejects(http.create('Test', ''));
    await plugins.install('cshell.http');
    const workspaceId = await http.create('Test', 'API');
    let w = http.workspace(workspaceId);
    assert.equal(w.tools.length, 4);
    const targetId = randomUUID();
    w.targets = [{ id: targetId, name: 'local', url: e.url }];
    const request = {
      ...newHttpRequest(),
      method: 'POST' as const,
      targetId,
      path: '/echo',
      bodyType: 'json' as const,
      body: '{"n":1}',
      headers: [{ enabled: true, name: 'Authorization', value: 'secret-value' }],
    };
    w.requests = [request];
    const old = structuredClone(w);
    w = await http.save(w);
    await assert.rejects(http.save(old), /已被修改/);
    const policy = {
      ...emptyAiPolicy(),
      application: ['http.use' as const],
      profiles: [workspaceId],
    };
    assert.equal(http.allowed('http_send', { workspaceId, request }, emptyAiPolicy()), false);
    assert.equal(http.allowed('http_send', { workspaceId, request }, policy), true);
    const tools = http.tools((name, input) => http.allowed(name, input, policy));
    const listing = await tools[0].invoke({}, new AbortController().signal);
    assert.ok(!listing.includes('secret-value'));
    const send = tools.find((t) => t.name === 'http_send')!;
    await send.invoke({ workspaceId, requestId: request.id }, new AbortController().signal);
    assert.equal(http.histories(workspaceId)[0].source, 'agent');
    assert.equal(
      JSON.parse(Buffer.from(http.histories(workspaceId)[0].response!.body, 'base64').toString())
        .secret,
      'secret-value',
    );
    assert.ok(!(await readFile(join(dir, 'http.enc'), 'utf8')).includes('secret-value'));
    assert.ok(!(await readFile(join(dir, 'config.json'), 'utf8')).includes('secret-value'));
    w.tools = w.tools.filter((t) => t !== 'http_send');
    await http.save(w);
    assert.equal(http.allowed('http_send', { workspaceId, request }, policy), false);
    const restored = new HttpWorkspaces(dir, store, registry);
    await restored.load();
    assert.equal(restored.histories(workspaceId).length, 1);
    await assert.rejects(
      http.send(workspaceId, { ...request, path: 'http://other.example/' }, randomUUID(), 'user'),
      /超出/,
    );
    await assert.rejects(
      http.send(workspaceId, { ...request, sender: randomUUID() }, randomUUID(), 'user'),
      /发送方/,
    );
    const runId = randomUUID();
    const pending = http.send(workspaceId, { ...request, path: '/slow' }, runId, 'user');
    await new Promise((r) => setTimeout(r, 50));
    http.cancel(runId);
    assert.equal((await pending).state, 'cancelled');
    await plugins.toggle('cshell.http', false);
    assert.throws(() => http.workspace(workspaceId), /启用/);
  } finally {
    http.dispose();
    await e.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test('Agent HTTP requires an explicit grant, uses separate authenticated channels and retains terminal on cancel', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cshell-agent-http-')),
    e = await endpoint();
  const terminal: ManagedProvider = {
    id: 'test.terminal',
    version: '1.0.0',
    configuration: z.string(),
    capabilities: [],
    connect: async () => randomUUID(),
    disconnect() {},
    resolve: () => {
      throw new Error('unused');
    },
  };
  const server = new ClientServer(new ClientVault(join(dir, 'server'), codec), terminal);
  await server.load();
  const client = new ClientProvider(new ClientVault(join(dir, 'client'), codec), () => {});
  await client.load();
  const portServer = createServer();
  await new Promise<void>((r) => portServer.listen(0, '127.0.0.1', r));
  const port = (portServer.address() as { port: number }).port;
  await new Promise<void>((r) => portServer.close(() => r()));
  try {
    const password = 'test-password-http-only';
    await server.setAccess({ password, shells: ['cmd'] });
    await server.start({ bind: '127.0.0.1', port });
    const info = await client.probe({ host: '127.0.0.1', port });
    await client.pairPassword(info, password);
    let session = await client.connect(
      { deviceId: info.deviceId, shell: 'cmd' },
      undefined,
      new AbortController().signal,
    );
    assert.equal(client.resolve(session).http, undefined);
    client.disconnect(session);
    await server.stop();
    await server.setAccess({ password, shells: ['cmd'], allowHttp: true });
    await server.start({ bind: '127.0.0.1', port });
    await client.pairPassword(info, password);
    session = await client.connect(
      { deviceId: info.deviceId, shell: 'cmd' },
      undefined,
      new AbortController().signal,
    );
    const sender = client.resolve(session).http!;
    assert.ok(sender);
    const input: HttpWireRequest = {
      url: e.url,
      method: 'GET',
      body: '',
      headers: [],
      timeoutMs: 15000,
    };
    assert.equal((await sender(input, new AbortController().signal)).status, 200);
    const abort = new AbortController(),
      pending = sender({ ...input, url: e.url + '/slow' }, abort.signal);
    setTimeout(() => abort.abort(), 100);
    await assert.rejects(pending);
    assert.ok(client.resolve(session));
    assert.equal((await sender(input, new AbortController().signal)).status, 200);
    const large = await sender({ ...input, url: e.url + '/large' }, new AbortController().signal);
    assert.equal(large.bytes, 65536);
    assert.ok(large.truncated);
    await server.revoke(server.status().peers[0].fingerprint);
    await assert.rejects(sender(input, new AbortController().signal));
  } finally {
    client.dispose();
    await server.stop();
    await e.close();
    await rm(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('AI HTTP dispatch is scoped, records target and invalidates approval after workspace or tool edits', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cshell-http-ai-')),
    e = await endpoint();
  const store = new Store(dir, codec);
  await store.load();
  await new PluginService(store).install('cshell.http');
  const registry = new ConnectionRegistry(() => undefined),
    http = new HttpWorkspaces(dir, store, registry);
  await http.load();
  const workspaceId = await http.create('AI API', '');
  let w = http.workspace(workspaceId);
  const request = { ...newHttpRequest(), path: e.url };
  w.requests = [request];
  await http.save(w);
  let turn = 0;
  const advertised: string[][] = [];
  const api = createServer(async (req, res) => {
    let body = '';
    for await (const b of req) body += b;
    const input = JSON.parse(body);
    advertised.push(input.tools?.map((t: any) => t.function.name) ?? []);
    const message =
      turn++ % 2 === 0
        ? {
            content: null,
            tool_calls: [
              {
                id: randomUUID(),
                type: 'function',
                function: {
                  name: 'http_send',
                  arguments: JSON.stringify({ workspaceId, requestId: request.id }),
                },
              },
            ],
          }
        : { content: 'done' };
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message }] }));
  });
  await new Promise<void>((r) => api.listen(0, '127.0.0.1', r));
  const ai = new AiService(dir, store, registry, undefined, { http });
  const provider = {
    id: randomUUID(),
    name: 'fixture',
    model: 'fixture',
    url: `http://127.0.0.1:${(api.address() as { port: number }).port}/v1`,
  };
  await ai.saveProvider(provider);
  const until = async (fn: () => boolean) => {
    const deadline = Date.now() + 8000;
    while (!fn()) {
      if (Date.now() > deadline) throw new Error('Timed out');
      await new Promise((r) => setTimeout(r, 15));
    }
  };
  try {
    await ai.savePolicy({ ...emptyAiPolicy(), application: ['http.use'], profiles: [workspaceId] });
    const thread = await ai.create('workspace', provider.id, 'restricted');
    await ai.send(thread.id, 'send');
    await until(() => !!ai.snapshot().threads.find((t) => t.id === thread.id)?.pending);
    let pending = ai.snapshot().threads.find((t) => t.id === thread.id)!.pending!;
    assert.match(pending.target!, /AI API.*本机.*GET/);
    assert.ok(advertised[0].includes('http_send'));
    w = http.workspace(workspaceId);
    w.requests[0].path = e.url + '/changed';
    await http.save(w);
    ai.approve(thread.id, pending.id, true);
    await until(() => ai.snapshot().threads.find((t) => t.id === thread.id)?.state === 'idle');
    assert.equal(e.requests.length, 0);
    await ai.send(thread.id, 'send current');
    await until(() => !!ai.snapshot().threads.find((t) => t.id === thread.id)?.pending);
    pending = ai.snapshot().threads.find((t) => t.id === thread.id)!.pending!;
    ai.approve(thread.id, pending.id, true);
    await until(() => ai.snapshot().threads.find((t) => t.id === thread.id)?.state === 'idle');
    assert.deepEqual(e.requests, ['/changed']);
    assert.equal(http.histories(workspaceId)[0].source, 'agent');
    w = http.workspace(workspaceId);
    w.tools = w.tools.filter((t) => t !== 'http_send');
    await http.save(w);
    await ai.send(thread.id, 'send disabled');
    await until(() => ai.snapshot().threads.find((t) => t.id === thread.id)?.state === 'idle');
    assert.equal(e.requests.length, 1);
    assert.ok(!advertised.at(-2)?.includes('http_send'));
  } finally {
    ai.dispose();
    http.dispose();
    api.closeAllConnections();
    await new Promise<void>((r) => api.close(() => r()));
    await e.close();
    await rm(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});
