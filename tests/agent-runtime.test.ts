import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { stripVTControlCharacters } from 'node:util';
import type { IPty } from 'node-pty';
import { createAgentRuntime } from '../src/agent/runtime';
import { callAgent, discoverAgent, callDiscoveredAgent } from '../src/agent/control';
import { agentCodec } from '../src/agent/storage';
import { AgentTerminalProvider, detectAgentShells } from '../src/core/agent-terminal';
import { createIdentity } from '../src/core/client/identity';
import { hashPassword } from '../src/core/client/password';
import { ClientProvider } from '../src/core/client/provider';
import { createServer } from 'node:net';
import { ClientVault } from '../src/core/client/identity';

test('independent Agent encrypts vault, authenticates local control, preserves imported identity and never auto-listens', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cshell-agent-runtime-'));
  const runtime = await createAgentRuntime({ directory });
  let restarted: Awaited<ReturnType<typeof createAgentRuntime>> | undefined;
  try {
    assert.equal(runtime.server.status().running, false);
    await runtime.startControl();
    const endpoint = await discoverAgent(directory);
    assert.ok(endpoint);
    assert.equal((await callAgent('client.status', undefined, directory)).running, false);
    await assert.rejects(
      callDiscoveredAgent({ ...endpoint, token: '0'.repeat(64) }, 'client.status'),
    );
    const forbidden = await fetch(`http://127.0.0.1:${endpoint.port}/control`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${endpoint.token}`, Origin: 'https://evil.example' },
      body: JSON.stringify({ method: 'client.status' }),
    });
    assert.equal(forbidden.status, 403);
    const unicodeToken = await fetch(`http://127.0.0.1:${endpoint.port}/control`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${'é'.repeat(64)}` },
      body: '{}',
    });
    assert.equal(unicodeToken.status, 403);
    assert.equal((await callAgent('client.status', undefined, directory)).running, false);
    const identity = await createIdentity();
    const access = {
      ...(await hashPassword('agent-preserved-password')),
      shells: ['cmd'],
      allowHttp: false,
    };
    const peer = { fingerprint: 'old-controller', name: 'legacy', shells: ['cmd'] };
    const imported = await callAgent(
      'legacy.import',
      { confirm: true, identity, access, peers: [peer] },
      directory,
    );
    assert.equal(imported.deviceId, identity.id);
    assert.equal(runtime.server.status().peers[0].fingerprint, peer.fingerprint);
    assert.equal(runtime.server.status().allowHttp, false);
    assert.equal(runtime.server.status().allowManage, false);
    assert.equal(runtime.server.status().running, false);
    assert.ok(!(await readFile(join(directory, 'identity.enc'), 'utf8')).includes(identity.key));
    await assert.rejects(
      callAgent('legacy.import', { confirm: true, identity, peers: [] }, directory),
    );
    await runtime.close();
    assert.equal(await discoverAgent(directory), undefined);
    restarted = await createAgentRuntime({ directory });
    assert.equal(restarted.server.status().deviceId, identity.id);
    assert.equal(restarted.server.status().running, false);
    assert.equal(restarted.server.status().peers[0].fingerprint, peer.fingerprint);
    const codec = await agentCodec(directory),
      encrypted = await codec.encrypt('private credential');
    assert.equal(await codec.decrypt(encrypted), 'private credential');
    const bytes = Buffer.from(encrypted, 'base64');
    bytes[13] ^= 1;
    await assert.rejects(codec.decrypt(bytes.toString('base64')));
  } finally {
    await runtime.close();
    await restarted?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('Agent runtime composes HTTP hosting without starting it during discovery', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cshell-agent-hosting-runtime-'));
  const runtime = await createAgentRuntime({ directory });
  try {
    const id = randomUUID();
    const saved = (await runtime.dispatch('hosting.save', {
      config: { id, name: 'Health', routes: [{ method: 'GET', path: '/health', body: 'ready' }] },
    })) as any;
    assert.equal(saved.running, false);
    const started = (await runtime.dispatch('hosting.start', {
      id,
      expectedRevision: saved.config.revision,
    })) as any;
    assert.equal(
      await (await fetch(`http://127.0.0.1:${started.actualPort}/health`)).text(),
      'ready',
    );
    assert.equal(((await runtime.dispatch('hosting.logs', { id })) as any[]).length, 1);
    await runtime.dispatch('hosting.stop', { id });
    await runtime.dispatch('hosting.remove', { id });
    assert.deepEqual(await runtime.dispatch('hosting.list', undefined), []);
    assert.equal(((await runtime.dispatch('relay.status', undefined)) as any).running, false);
    await assert.rejects(
      runtime.dispatch('hosting.save', {
        config: { id, name: 'External', host: '0.0.0.0', routes: [{ method: 'GET', path: '/' }] },
      }),
    );
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('Agent PTY selects only detected shells and bounds output until acknowledgement', async () => {
  let data: (value: string) => void = () => {},
    exit: (value: { exitCode: number }) => void = () => {};
  let paused = 0,
    resumed = 0,
    killed = 0;
  const pty = {
    onData: (fn: typeof data) => {
      data = fn;
    },
    onExit: (fn: typeof exit) => {
      exit = fn;
    },
    write: () => {},
    resize: () => {},
    pause: () => paused++,
    resume: () => resumed++,
    kill: () => {
      killed++;
      exit({ exitCode: 0 });
    },
  } as unknown as IPty;
  const provider = new AgentTerminalProvider(
    () => {},
    async () => [
      { id: 'bash', label: 'Bash', executable: '/bin/bash', args: ['-l'], environment: 'host' },
    ],
    () => pty,
  );
  await assert.rejects(provider.connect('cmd', undefined, new AbortController().signal));
  const id = await provider.connect('bash', undefined, new AbortController().signal);
  data('a'.repeat(262144));
  assert.equal(paused, 1);
  provider.resolve(id).terminal!.acknowledge(999999);
  assert.equal(resumed, 0);
  provider.resolve(id).terminal!.acknowledge(262144);
  assert.equal(resumed, 1);
  data('b'.repeat(1048577));
  assert.equal(killed, 1);
  assert.equal(provider.size, 0);
  assert.throws(() => provider.resolve(id));
});

test('Agent runs a real native persistent PTY on this platform without SSH or Electron', async () => {
  const shells = await detectAgentShells();
  const preferred = shells.find((s) => s.id === (process.platform === 'win32' ? 'cmd' : 'sh'));
  assert.ok(preferred, 'native OS shell must be detected');
  let output = '';
  const provider = new AgentTerminalProvider((event) => {
    if (event.type === 'data') {
      output += event.data;
      try {
        provider.resolve(event.sessionId).terminal!.acknowledge(event.data.length);
      } catch {}
    }
  });
  try {
    const id = await provider.connect(preferred.id, undefined, new AbortController().signal);
    const marker = 'CSHELL_AGENT_NATIVE_TEST';
    const command =
      process.platform === 'win32'
        ? 'echo CSHELL_AGENT_NATIVE_^TEST\r'
        : "printf '\\nCSHELL_AGENT_NATIVE_%s\\n' TEST\r";
    // The input never contains the complete marker; only shell execution can
    // produce it, including when a POSIX prompt precedes the result on a line.
    assert.ok(!command.includes(marker));
    provider.resolve(id).terminal!.input(command);
    const deadline = Date.now() + 10000;
    const resultLine = /CSHELL_AGENT_NATIVE_TEST(?=\r|\n|\x1b|$)/;
    while (!resultLine.test(output) && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 50));
    assert.match(output, resultLine);
    assert.equal(provider.size, 1);
    provider.resolve(id).terminal!.input('exit\r');
    const exitDeadline = Date.now() + 5000;
    while (provider.size && Date.now() < exitDeadline)
      await new Promise((resolve) => setTimeout(resolve, 50));
  } finally {
    await provider.dispose();
  }
});

test('Agent commands execute independently with bounded output, actual exit code and cancellation', async () => {
  const available = (await detectAgentShells()).filter((s) => s.environment === 'host');
  const shell = process.platform === 'win32' ? 'powershell' : 'sh';
  const provider = new AgentTerminalProvider(
    () => {},
    async () => available,
  );
  const success = await provider.execute(
    {
      shell,
      command:
        process.platform === 'win32'
          ? "Write-Output 'executed-result'; exit 7"
          : "printf 'executed-result'; exit 7",
    },
    new AbortController().signal,
  );
  assert.match(success.stdout, /executed-result/);
  assert.equal(success.exitCode, 7);
  assert.equal(success.environment, 'host');
  const huge = await provider.execute(
    {
      shell,
      command:
        process.platform === 'win32' ? "Write-Output ('x' * 70000)" : 'head -c 70000 /dev/zero',
    },
    new AbortController().signal,
  );
  assert.equal(huge.truncated, true);
  assert.ok(Buffer.byteLength(huge.stdout) + Buffer.byteLength(huge.stderr) <= 65536);
  const abort = new AbortController();
  const pending = provider.execute(
    { shell, command: process.platform === 'win32' ? 'Start-Sleep -Seconds 30' : 'sleep 30' },
    abort.signal,
  );
  setTimeout(() => abort.abort(), 250);
  await assert.rejects(pending, /取消/);
  const timeout = provider.execute(
    {
      shell,
      command: process.platform === 'win32' ? 'Start-Sleep -Seconds 30' : 'sleep 30',
      timeoutMs: 500,
    },
    new AbortController().signal,
  );
  await assert.rejects(timeout, /超时/);
  await assert.rejects(
    provider.execute({ shell: 'wsl', command: 'id' }, new AbortController().signal),
    /发行版/,
  );
});

test(
  'Agent native protocol opens a detected WSL PTY and binds independent commands to that distribution',
  { timeout: 60000 },
  async (context) => {
    if (process.platform !== 'win32') {
      context.skip('WSL is a Windows-only provider');
      return;
    }
    const distribution = (await detectAgentShells()).find(
      (s) => s.environment === 'wsl',
    )?.distribution;
    if (!distribution) {
      context.skip('No actual installed WSL distribution');
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'cshell-agent-wsl-native-'));
    const runtime = await createAgentRuntime({ directory: join(directory, 'agent') });
    let output = '';
    const client = new ClientProvider(
      new ClientVault(join(directory, 'controller'), {
        encrypt: async (value) => Buffer.from(value).toString('base64'),
        decrypt: async (value) => Buffer.from(value, 'base64').toString(),
      }),
      (event) => {
        if (event.type === 'data') {
          output += event.data;
          try {
            client.resolve(event.sessionId).terminal!.acknowledge(event.data.length);
          } catch {}
        }
      },
    );
    let session: string | undefined;
    try {
      const portServer = createServer();
      await new Promise<void>((resolve) => portServer.listen(0, '127.0.0.1', resolve));
      const port = (portServer.address() as { port: number }).port;
      await new Promise<void>((resolve) => portServer.close(() => resolve()));
      await runtime.dispatch('client.access', {
        password: 'wsl-native-test-password',
        shells: ['wsl'],
      });
      await runtime.dispatch('client.start', { bind: '127.0.0.1', port });
      await client.load();
      const device = await client.pairPassword(
        await client.probe({ host: '127.0.0.1', port }),
        'wsl-native-test-password',
      );
      session = await client.connect(
        { deviceId: device.deviceId, shell: 'wsl', distribution },
        undefined,
        new AbortController().signal,
      );
      // A connected PTY is not yet a ready Linux shell. Match readline readiness
      // or a visible shell prompt, as a person using the desktop terminal would.
      // Startup and command execution share the original 20-second deadline.
      const end = Date.now() + 20000;
      const ready = () =>
        output.includes('\x1b[?2004h') || /[$#>%] $/.test(stripVTControlCharacters(output));
      while (!ready() && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 50));
      assert.ok(
        ready(),
        `WSL ${distribution} did not present a shell prompt: ${JSON.stringify(output)}`,
      );
      context.diagnostic(`WSL ${distribution} shell ready with ${end - Date.now()} ms remaining`);
      client
        .resolve(session)
        .terminal!.input("printf '\\nCSHELL_AGENT_WSL_%s\\n' OK; uname -s; id -u\r");
      const result = /(?:^|\n|\x1b\[\d+(?:;\d+)?[Hf])CSHELL_AGENT_WSL_OK(?=\r|\n|\x1b|$)/;
      while (!result.test(output) && Date.now() < end)
        await new Promise((resolve) => setTimeout(resolve, 50));
      assert.match(output, result);
      const tool = client
        .resolve(session)
        .tools.find((tool) => tool.capability === 'commands.execute');
      assert.ok(tool);
      const executed = JSON.parse(
        await tool.invoke({ command: 'uname -s; id -u; pwd' }, new AbortController().signal),
      );
      assert.equal(executed.environment, 'wsl');
      assert.equal(executed.distribution, distribution);
      assert.equal(executed.exitCode, 0);
      assert.match(executed.stdout, /Linux/);
      context.diagnostic(
        `Verified actual ${distribution}: independent command environment=${executed.environment}; kernel=Linux; no account or system setting changed`,
      );
      client.resolve(session).terminal!.input('exit\r');
      const closed = Date.now() + 5000;
      while (runtime.terminal.size && Date.now() < closed)
        await new Promise((resolve) => setTimeout(resolve, 50));
    } finally {
      if (session) client.disconnect(session);
      await runtime.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
