import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { callAgent } from '../src/agent/control';
import { ClientProvider } from '../src/core/client/provider';
import { ClientVault, fingerprint } from '../src/core/client/identity';

const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const staged = resolve(
  process.argv[2] || `release/${version}/agent-${process.platform}-${process.arch}`,
);
const info = JSON.parse(await readFile(join(staged, 'build-info.json'), 'utf8'));
assert.equal(info.version, version);
assert.equal(info.platform, process.platform);
assert.equal(info.arch, process.arch);
assert.equal(info.electron, false);
const directory = await mkdtemp(join(tmpdir(), 'cshell-agent-package-'));
const child = spawn(
  join(staged, process.platform === 'win32' ? 'node.exe' : 'node'),
  [join(staged, 'agent.cjs'), 'run'],
  {
    env: { ...process.env, CSHELL_AGENT_DATA: directory },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
let diagnostic = '';
child.stdout.resume();
child.stderr.on('data', (d) => {
  diagnostic = (diagnostic + d).slice(-4000);
});
let childError: Error | undefined;
child.once('error', (error) => {
  childError = error;
});
let output = '';
const provider = new ClientProvider(
  new ClientVault(join(directory, 'test-controller'), {
    // Ephemeral fixture credentials; never used for installed user storage.
    encrypt: async (text) => Buffer.from(text).toString('base64'),
    decrypt: async (text) => Buffer.from(text, 'base64').toString(),
  }),
  (event) => {
    if (event.type === 'data') {
      output = (output + event.data).slice(-200000);
      try {
        provider.resolve(event.sessionId).terminal?.acknowledge(event.data.length);
      } catch {
        /* setup race */
      }
    }
  },
);
async function until(condition: () => boolean | Promise<boolean>, ms = 30000) {
  const limit = Date.now() + ms;
  while (Date.now() < limit) {
    if (childError) throw childError;
    if (child.exitCode !== null) throw new Error(`Agent exited: ${diagnostic}`);
    if (await condition()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Packaged Agent timeout: ${diagnostic}`);
}
try {
  await until(async () => {
    try {
      return !!(await callAgent('client.status', undefined, directory));
    } catch {
      return false;
    }
  });
  assert.equal(
    (await callAgent('client.status', undefined, directory)).running,
    false,
    'Installation must not enable remote listening',
  );
  const shells = (await callAgent('agent.shells', undefined, directory)) as { shell: string }[];
  const shell =
    process.platform === 'win32'
      ? 'cmd'
      : shells.find((s) => ['bash', 'sh', 'zsh'].includes(s.shell))?.shell;
  assert.ok(shell && shells.some((s) => s.shell === shell));
  const password = randomUUID();
  await callAgent(
    'client.access',
    {
      password,
      shells: [shell],
      allowManage: false,
      allowHttp: false,
      allowHosting: false,
      allowRelay: false,
    },
    directory,
  );
  const portServer = createServer().listen(0, '127.0.0.1');
  await once(portServer, 'listening');
  const port = (portServer.address() as { port: number }).port;
  await new Promise<void>((r) => portServer.close(() => r()));
  await callAgent('client.start', { bind: '127.0.0.1', port }, directory);
  await provider.load();
  const probe = await provider.probe({ host: '127.0.0.1', port });
  const expectedIdentity = await callAgent('client.status', undefined, directory);
  assert.equal(probe.deviceId, expectedIdentity.deviceId);
  assert.equal(fingerprint(probe.certificate), expectedIdentity.fingerprint);
  await provider.pairPassword(probe, password);
  const sessionId = await provider.connect(
    { deviceId: probe.deviceId, shell },
    {},
    new AbortController().signal,
  );
  const session = provider.resolve(sessionId);
  const marker = 'AGENT_PACKAGE_' + randomUUID().replaceAll('-', '');
  session.terminal!.resize(100, 30);
  session.terminal!.input(
    shell === 'cmd'
      ? `echo ${marker.slice(0, 10)}%COMSPEC:~999,1%${marker.slice(10)}\r`
      : `printf '%s%s\\n' '${marker.slice(0, 10)}' '${marker.slice(10)}'\r`,
  );
  await until(() => output.includes(marker));
  await assert.rejects(
    provider.call(probe.deviceId, { method: 'client.status' }),
    /未授予|permission|授权/,
  );
  provider.disconnect(sessionId);
  await callAgent('client.stop', undefined, directory);
  assert.equal((await callAgent('client.status', undefined, directory)).running, false);
  console.log(
    `PASS: packaged Agent ${info.platform}/${info.arch}, real ${shell} PTY, TLS, restricted authorization, stop`,
  );
} finally {
  provider.dispose();
  await callAgent('agent.shutdown', { confirm: true }, directory).catch(() => {});
  if (child.exitCode === null) {
    await Promise.race([once(child, 'exit'), new Promise((r) => setTimeout(r, 3000))]);
    if (child.exitCode === null) child.kill(); // Only this isolated fixture process.
  }
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
