import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/core/store';
import { McpService } from '../src/core/mcp';
import { ConnectionRegistry } from '../src/core/connections/registry';
import { ConnectionManager } from '../src/core/connections/manager';
import { LocalTerminalProvider } from '../src/core/connections/local-terminal-provider';

test(
  'real ConPTY API requires explicit local scope and keeps terminal ownership and output',
  { skip: process.platform !== 'win32' },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cshell-api-local-'));
    const store = new Store(dir, {
      encrypt: async (s) => Buffer.from(s).toString('base64'),
      decrypt: async (s) => Buffer.from(s, 'base64').toString(),
    });
    await store.load();
    let service: McpService;
    const manager = new ConnectionManager(new ConnectionRegistry(() => undefined));
    const local = new LocalTerminalProvider(dir, store, (event) => {
      service?.event(event);
      if (event.type === 'closed') manager.closed(event.sessionId);
    });
    await local.load();
    manager.register(local);
    const probe = createServer();
    await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
    const port = (probe.address() as { port: number }).port;
    await new Promise<void>((r) => probe.close(() => r()));
    service = new McpService(store, dir, async () => true, {
      manager,
      connect: async () => {
        throw new Error('No remote targets');
      },
      localShells: async () => ['cmd', 'powershell'],
      connectLocal: (shell, signal, ready) =>
        manager.connect(local.id, shell, undefined, signal, ready),
    });
    try {
      const settings = {
        enabled: true,
        port,
        allowedProfiles: [],
        allowCommands: false,
        capabilities: ['terminal.read', 'terminal.input'] as const,
        review: 'authorized' as const,
      };
      await service.configure({ ...settings, capabilities: [...settings.capabilities] });
      let token = await service.accessToken();
      const call = async (name: string, args: object = {}) => {
        const res = await fetch(`http://127.0.0.1:${port}/api/v1/invoke`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Connection: 'close',
          },
          body: JSON.stringify({ name, arguments: args }),
        });
        return res.json();
      };
      assert.equal((await call('list_local_targets')).error.code, 'NOT_FOUND');
      await service.configure({
        ...settings,
        capabilities: [...settings.capabilities],
        allowedLocalShells: ['cmd'],
      });
      token = await service.accessToken();
      const targets = (await call('list_local_targets')).result;
      assert.equal(targets.length, 1);
      assert.equal(targets[0].shell, 'cmd');
      const connected = await call('connect', { profileId: targets[0].profileId });
      assert.ok(connected.result?.sessionId, JSON.stringify(connected));
      const sessionId = connected.result.sessionId;
      assert.equal(
        (
          await call('terminal_input', {
            sessionId,
            expectedSequence: 0,
            data: 'echo cshell-local-api-verified\r',
          })
        ).result.accepted,
        true,
      );
      let text = '';
      for (let i = 0; i < 100; i++) {
        const read = await call('terminal_read', { sessionId });
        text = Buffer.from(read.result.data, 'base64').toString();
        if (text.includes('cshell-local-api-verified')) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.match(text, /cshell-local-api-verified/);
      assert.deepEqual((await call('describe_connection', { sessionId })).result.tools, []);
      await service.configure({ ...settings, capabilities: [...settings.capabilities] });
      assert.equal(
        (await call('terminal_input', { sessionId, expectedSequence: 1, data: 'echo denied\r' }))
          .error.code,
        'NOT_FOUND',
      );
    } finally {
      await service.stop();
      await rm(dir, { recursive: true, force: true, maxRetries: 5 });
    }
  },
);
