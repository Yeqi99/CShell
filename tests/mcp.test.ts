import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpService } from '../src/core/mcp';
import { Store } from '../src/core/store';
import { SshService } from '../src/core/ssh';
import { fixture } from './fixture';

test('authenticated MCP lifecycle, origin isolation, scoped SSH tools, command consent and token revocation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cshell-mcp-'));
  const fixtureServer = await fixture();
  const store = new Store(directory, {
    encrypt: async (value) => Buffer.from(value).toString('base64'),
    decrypt: async (value) => Buffer.from(value, 'base64').toString(),
  });
  await store.load();
  const profile = {
    id: randomUUID(),
    name: 'MCP test',
    host: '127.0.0.1',
    port: fixtureServer.port,
    username: 'tester',
    group: '',
    favorite: false,
    auth: 'password' as const,
  };
  await store.saveProfile(profile);
  await store.setSecret(profile.id, { password: fixtureServer.password });
  const trusted = new SshService(
    () => {},
    async (_profile, fingerprint) => {
      await store.trust(`${profile.host}:${profile.port}`, fingerprint);
      return true;
    },
  );
  const initial = await trusted.connect(profile, { password: fixtureServer.password });
  trusted.disconnect(initial.sessionId);
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  let consent = false;
  const service = new McpService(store, directory, async () => consent);
  const client = new Client({ name: 'CShell-test', version: '1' });
  try {
    assert.equal(service.status().running, false);
    await service.configure({
      enabled: true,
      port,
      allowedProfiles: [profile.id],
      allowCommands: false,
    });
    assert.equal(service.status().running, true);
    const url = `http://127.0.0.1:${port}/mcp`,
      token = await service.accessToken();
    assert.equal(
      (await fetch(url, { method: 'POST', headers: { Connection: 'close' } })).status,
      401,
    );
    assert.equal(
      (
        await fetch(url, {
          method: 'POST',
          headers: {
            Connection: 'close',
            Authorization: `Bearer ${token}`,
            Origin: 'https://evil.example',
          },
        })
      ).status,
      403,
    );
    await client.connect(
      new StreamableHTTPClientTransport(new URL(url), {
        requestInit: { headers: { Connection: 'close', Authorization: `Bearer ${token}` } },
      }),
    );
    assert.ok(!(await client.listTools()).tools.some((tool) => tool.name === 'execute_command'));
    const listed = await client.callTool({ name: 'list_servers' });
    assert.ok(JSON.stringify(listed).includes(profile.id));
    assert.ok(!JSON.stringify(listed).includes(fixtureServer.password));
    assert.equal(
      (await client.callTool({ name: 'connect', arguments: { profileId: randomUUID() } })).isError,
      true,
    );
    const connected = await client.callTool({
      name: 'connect',
      arguments: { profileId: profile.id },
    });
    const sessionId = JSON.parse((connected.content as { text: string }[])[0].text).sessionId;
    assert.ok(
      JSON.stringify(
        await client.callTool({ name: 'list_files', arguments: { sessionId, path: '.' } }),
      ).includes('hello.txt'),
    );
    assert.equal(
      (await client.callTool({ name: 'monitor', arguments: { sessionId: randomUUID() } })).isError,
      true,
    );
    const burst = await Promise.allSettled(
      Array.from({ length: 9 }, () =>
        client.callTool({ name: 'connect', arguments: { profileId: profile.id } }),
      ),
    );
    const opened = burst.filter((result) => result.status === 'fulfilled' && !result.value.isError);
    assert.ok(opened.length <= 7, 'one existing connection plus burst must stay within 8');
    await service.configure({
      enabled: true,
      port,
      allowedProfiles: [profile.id],
      allowCommands: true,
    });
    const next = await client.callTool({ name: 'connect', arguments: { profileId: profile.id } });
    const nextId = JSON.parse((next.content as { text: string }[])[0].text).sessionId;
    assert.equal(
      (
        await client.callTool({
          name: 'execute_command',
          arguments: { sessionId: nextId, command: 'test' },
        })
      ).isError,
      true,
    );
    consent = true;
    assert.ok(
      !(
        await client.callTool({
          name: 'execute_command',
          arguments: { sessionId: nextId, command: 'test' },
        })
      ).isError,
    );
    await service.rotateToken();
    assert.equal(
      (
        await fetch(url, {
          method: 'POST',
          headers: { Connection: 'close', Authorization: `Bearer ${token}` },
        })
      ).status,
      401,
    );
    await service.configure({ enabled: false, port, allowedProfiles: [], allowCommands: false });
    assert.equal(service.status().running, false);
  } finally {
    await client.close();
    await service.stop();
    trusted.dispose();
    await fixtureServer.close();
    await rm(directory, { recursive: true, force: true });
  }
});
