import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { createAgentRuntime } from '../src/agent/runtime';
import { ClientProvider } from '../src/core/client/provider';
import { ClientVault } from '../src/core/client/identity';
import { ConnectionRegistry } from '../src/core/connections/registry';
import { ConnectionManager } from '../src/core/connections/manager';
import { Store } from '../src/core/store';
import { McpService } from '../src/core/mcp';

async function freePort() {
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((r) => server.close(() => r()));
  return port;
}

test(
  'API reaches an explicitly paired native Agent, discovers real tools and preserves terminal ownership',
  { timeout: 60000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cshell-api-agent-'));
    const codec = {
      encrypt: async (v: string) => Buffer.from(v).toString('base64'),
      decrypt: async (v: string) => Buffer.from(v, 'base64').toString(),
    };
    const store = new Store(join(directory, 'store'), codec);
    await store.load();
    const runtime = await createAgentRuntime({ directory: join(directory, 'agent') });
    const shell = process.platform === 'win32' ? 'cmd' : 'bash';
    const agentPort = await freePort();
    let service: McpService | undefined;
    const provider = new ClientProvider(
      new ClientVault(join(directory, 'controller'), codec),
      (event) => {
        if (!service?.event(event) && event.type === 'data') {
          try {
            provider.resolve(event.sessionId).terminal?.acknowledge(event.data.length);
          } catch {}
        }
      },
    );
    const registry = new ConnectionRegistry((target) => ({ id: target.resourceId, group: '' }));
    const manager = new ConnectionManager(registry);
    manager.register(provider);
    try {
      await runtime.server.setAccess({ password: 'api-agent-test-password', shells: [shell] });
      await runtime.server.start({ bind: '127.0.0.1', port: agentPort });
      await provider.load();
      const device = await provider.pairPassword(
        await provider.probe({ host: '127.0.0.1', port: agentPort }),
        'api-agent-test-password',
      );
      await store.saveProfile({
        id: device.deviceId,
        name: 'Native test Agent',
        protocol: 'client',
        host: '127.0.0.1',
        port: agentPort,
        username: 'agent',
        group: '',
        favorite: false,
        auth: 'password',
        clientShell: shell,
      });
      const interactive = await manager.connect(
        'cshell.client',
        { deviceId: device.deviceId, shell },
        undefined,
        new AbortController().signal,
      );
      service = new McpService(store, join(directory, 'store'), async () => true, {
        manager,
        connect: (profile, signal, ready) =>
          manager.connect(
            'cshell.client',
            { deviceId: profile.id, shell },
            undefined,
            signal,
            ready,
          ),
      });
      const port = await freePort();
      await service.configure({
        enabled: true,
        port,
        allowedProfiles: [device.deviceId],
        allowCommands: true,
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
        const body = await response.json();
        assert.equal(response.status, 200, JSON.stringify(body));
        return body.result;
      };
      const decode = (result: { content: { text: string }[] }) =>
        JSON.parse(result.content[0].text);
      const sessionId = decode(await call('connect', { profileId: device.deviceId })).sessionId;
      assert.ok(sessionId);
      const discovered = decode(await call('describe_connection', { sessionId }));
      assert.equal(discovered.target.providerId, 'cshell.client');
      assert.ok(discovered.tools.some((t: { name: string }) => t.name === 'execute_command'));
      assert.ok(!discovered.tools.some((t: { name: string }) => t.name === 'read_file'));
      assert.equal((await call('describe_connection', { sessionId: interactive })).isError, true);
      const result = decode(
        await call('invoke_connection', {
          sessionId,
          tool: 'execute_command',
          arguments: { command: 'echo CSHELL_API_AGENT_OK' },
        }),
      );
      const executed = JSON.parse(result);
      assert.equal(executed.exitCode, 0);
      assert.match(executed.stdout, /CSHELL_API_AGENT_OK/);
      await service.stop();
      assert.equal(
        manager.tools.describe(interactive).providerId,
        'cshell.client',
        'API stop must preserve desktop-owned terminal',
      );
      await manager.disconnect(interactive);
    } finally {
      await service?.stop();
      provider.dispose();
      await runtime.close();
      await rm(directory, { recursive: true, force: true, maxRetries: 5 });
    }
  },
);
