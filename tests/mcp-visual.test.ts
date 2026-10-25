import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpService } from '../src/core/mcp';
import { Store } from '../src/core/store';
import { ConnectionManager } from '../src/core/connections/manager';
import { ConnectionRegistry } from '../src/core/connections/registry';
import { visualToolSource } from '../src/core/visual-tools';
import { visualCapabilities } from '../src/shared/visual-tools';
test('actual MCP and REST keep visual permissions separate and deliver image bytes only through image content', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mcp-visual-')),
    store = new Store(directory, {
      encrypt: async (v) => Buffer.from(v).toString('base64'),
      decrypt: async (v) => Buffer.from(v, 'base64').toString(),
    });
  await store.load();
  const profile = {
    id: randomUUID(),
    name: 'visual fixture',
    host: 'example.test',
    username: 'test',
    port: 22,
    group: '',
    favorite: false,
    auth: 'password' as const,
  };
  await store.saveProfile(profile);
  const registry = new ConnectionRegistry(() => ({ id: profile.id, group: '' })),
    manager = new ConnectionManager(registry);
  const connection = {
    target: {
      providerId: 'cshell.ssh',
      resourceId: profile.id,
      identity: 'fixture',
      label: 'visual fixture',
    },
    tools: [],
  };
  manager.register({
    id: 'cshell.ssh',
    version: '1.0.0',
    capabilities: [],
    configuration: z.unknown(),
    resolve: () => connection,
    connect: async () => randomUUID(),
    disconnect: () => {},
  });
  const image = {
    mimeType: 'image/jpeg',
    dataBase64: Buffer.from([255, 216, 255, 217]).toString('base64'),
    width: 320,
    height: 240,
    target: 'fixture',
    frameId: '1',
  };
  let calls = 0;
  registry.registerToolSource(
    'cshell.visual',
    visualCapabilities,
    visualToolSource({
      browser: async () => {
        calls++;
        return image;
      },
      desktop: async () => image,
    }),
  );
  const probe = createServer();
  await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
  const port = (probe.address() as any).port;
  await new Promise<void>((r) => probe.close(() => r()));
  const service = new McpService(store, directory, async () => true, {
      manager,
      connect: async (p, s, ready) => manager.connect('cshell.ssh', p, {}, s, ready),
    }),
    client = new Client({ name: 'visual fixture', version: '1' });
  const settings = {
    enabled: true,
    port,
    allowedProfiles: [profile.id],
    allowCommands: false,
    capabilities: [] as any[],
    review: 'authorized' as const,
  };
  try {
    assert.equal(service.status().running, false);
    await service.configure(settings);
    const token = await service.accessToken();
    const invoke = async (name: string, args: unknown) => {
      const r = await fetch('http://127.0.0.1:' + port + '/api/v1/invoke', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
          Connection: 'close',
        },
        body: JSON.stringify({ name, arguments: args }),
      });
      return { status: r.status, body: (await r.json()) as any };
    };
    let sessionId = (await invoke('connect', { profileId: profile.id })).body.result.sessionId;
    assert.equal(
      (
        await invoke('invoke_connection', {
          sessionId,
          tool: 'browser_screenshot',
          arguments: { tabId: randomUUID() },
        })
      ).status,
      403,
    );
    assert.equal(calls, 0);
    await service.configure({ ...settings, capabilities: ['browser.read'] });
    sessionId = (await invoke('connect', { profileId: profile.id })).body.result.sessionId;
    const rest = await invoke('invoke_connection', {
      sessionId,
      tool: 'browser_screenshot',
      arguments: { tabId: randomUUID() },
    });
    assert.equal(rest.status, 200);
    assert.ok(JSON.stringify(rest.body.result).includes(image.dataBase64));
    await client.connect(
      new StreamableHTTPClientTransport(new URL('http://127.0.0.1:' + port + '/mcp'), {
        requestInit: { headers: { Authorization: 'Bearer ' + token, Connection: 'close' } },
      }),
    );
    const own = await client.callTool({ name: 'connect', arguments: { profileId: profile.id } });
    sessionId = JSON.parse((own.content as any)[0].text).sessionId;
    const result = await client.callTool({
      name: 'invoke_connection',
      arguments: { sessionId, tool: 'browser_screenshot', arguments: { tabId: randomUUID() } },
    });
    assert.equal((result.content as any)[1].type, 'image');
    assert.equal((result.content as any)[1].data, image.dataBase64);
    assert.ok(!JSON.stringify((result.content as any)[0]).includes(image.dataBase64));
    assert.equal(
      (
        await client.callTool({
          name: 'invoke_connection',
          arguments: {
            sessionId,
            tool: 'browser_interact',
            arguments: {
              tabId: randomUUID(),
              action: 'fill',
              snapshotId: randomUUID(),
              ref: 'e1',
              text: 'private-otp',
            },
          },
        })
      ).isError,
      true,
    );
  } finally {
    await client.close().catch(() => {});
    await service.configure({ ...settings, enabled: false });
    await rm(directory, { recursive: true, force: true });
  }
});
