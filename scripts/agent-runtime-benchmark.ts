import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir, release, cpus } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';
import { callAgent } from '../src/agent/control';
import { ClientProvider } from '../src/core/client/provider';
import { ClientVault } from '../src/core/client/identity';

const exec = promisify(execFile);
const stage = resolve(process.argv[2] || 'release/0.6.0/agent-win32-x64');
const directory = await mkdtemp(join(tmpdir(), 'cshell-agent-benchmark-'));
const node = join(stage, process.platform === 'win32' ? 'node.exe' : 'node');
const child = spawn(node, [join(stage, 'agent.cjs'), 'run'], {
  env: { ...process.env, CSHELL_AGENT_DATA: directory },
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stderr = '';
child.stdout.resume();
child.stderr.on('data', (chunk) => {
  stderr = (stderr + chunk).slice(-65536);
});
const exited = new Promise<number | null>((resolveExit) => child.once('exit', resolveExit));
const pause = (ms: number) => new Promise((resolvePause) => setTimeout(resolvePause, ms));
async function until(check: () => boolean | Promise<boolean>, timeout = 30000) {
  const end = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('Benchmark wait timeout: ' + stderr);
    await pause(50);
  }
}
async function sample() {
  if (process.platform === 'win32') {
    const ps = join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32/WindowsPowerShell/v1.0/powershell.exe',
    );
    const { stdout } = await exec(
      ps,
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$p=Get-Process -Id ${child.pid}; @{rss=$p.WorkingSet64;cpuSeconds=$p.CPU;handles=$p.HandleCount;time=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()}|ConvertTo-Json -Compress`,
      ],
      { windowsHide: true },
    );
    return JSON.parse(stdout);
  }
  const { stdout } = await exec('ps', ['-o', 'rss=', '-o', 'time=', '-p', String(child.pid)]);
  const parts = stdout.trim().split(/\s+/),
    time = parts[1].split(':').map(Number);
  return {
    rss: Number(parts[0]) * 1024,
    cpuSeconds: time.reduce((n, v) => n * 60 + v, 0),
    time: Date.now(),
  };
}
let autoAck = true;
const totals = new Map<string, number>(),
  tails = new Map<string, string>();
const client = new ClientProvider(
  new ClientVault(join(directory, 'benchmark-controller'), {
    encrypt: async (value) => Buffer.from(value).toString('base64'),
    decrypt: async (value) => Buffer.from(value, 'base64').toString(),
  }),
  (event) => {
    if (event.type !== 'data') return;
    totals.set(event.sessionId, (totals.get(event.sessionId) || 0) + event.data.length);
    tails.set(event.sessionId, ((tails.get(event.sessionId) || '') + event.data).slice(-4096));
    if (autoAck)
      try {
        client.resolve(event.sessionId).terminal!.acknowledge(event.data.length);
      } catch {}
  },
);
const sessions: string[] = [];
try {
  await until(async () => {
    try {
      return !!(await callAgent('client.status', undefined, directory));
    } catch {
      return false;
    }
  });
  const initial = await callAgent('client.status', undefined, directory);
  assert.equal(initial.running, false);
  const idleBefore = await sample();
  await pause(2000);
  const idle = await sample();
  const idleCpuPercent =
    (100 * (idle.cpuSeconds - idleBefore.cpuSeconds)) / ((idle.time - idleBefore.time) / 1000);
  const portServer = createServer();
  await new Promise<void>((resolvePort) => portServer.listen(0, '127.0.0.1', resolvePort));
  const port = (portServer.address() as { port: number }).port;
  await new Promise<void>((resolvePort) => portServer.close(() => resolvePort()));
  const shell = process.platform === 'win32' ? 'cmd' : 'sh',
    password = 'benchmark-only-password';
  await callAgent('client.access', { password, shells: [shell] }, directory);
  await callAgent('client.start', { bind: '127.0.0.1', port }, directory);
  await client.load();
  const device = await client.pairPassword(
    await client.probe({ host: '127.0.0.1', port }),
    password,
  );
  for (let i = 0; i < 4; i++)
    sessions.push(
      await client.connect(
        { deviceId: device.deviceId, shell },
        undefined,
        new AbortController().signal,
      ),
    );
  const outputBefore = await sample();
  const bulk =
    process.platform === 'win32'
      ? `for /l %i in (1,1,2000) do @echo ${'x'.repeat(512)}\recho AGENT_BENCH_DONE\r`
      : `i=0; while [ "$i" -lt 2000 ]; do printf '%s\\n' '${'x'.repeat(512)}'; i=$((i+1)); done; printf '\\nAGENT_BENCH_DONE\\n'\r`;
  for (const id of sessions) client.resolve(id).terminal!.input(bulk);
  await until(
    () =>
      sessions.every((id) => /(?:^|\n)AGENT_BENCH_DONE(?=\r|\n|\x1b|$)/.test(tails.get(id) || '')),
    60000,
  );
  const active = await sample(),
    charsWithAck = [...totals.values()].reduce((n, v) => n + v, 0);
  for (const id of sessions) assert.ok((totals.get(id) || 0) > 1000000);
  autoAck = false;
  const id = sessions[0],
    beforeBlocked = totals.get(id) || 0;
  tails.set(id, '');
  client.resolve(id).terminal!.input(bulk);
  await pause(2000);
  const blocked = await sample(),
    blockedCharacters = (totals.get(id) || 0) - beforeBlocked;
  assert.ok(
    blockedCharacters > 200000 && blockedCharacters < 600000,
    `unacknowledged data must be bounded: ${blockedCharacters}`,
  );
  autoAck = true;
  client.resolve(id).terminal!.acknowledge(blockedCharacters);
  await until(() => /(?:^|\n)AGENT_BENCH_DONE(?=\r|\n|\x1b|$)/.test(tails.get(id) || ''), 30000);
  for (const session of sessions) client.disconnect(session);
  await callAgent('client.stop', undefined, directory);
  await pause(1500);
  const after = await sample();
  await callAgent('agent.shutdown', { confirm: true }, directory);
  const code = await Promise.race([
    exited,
    pause(10000).then(() => {
      throw new Error('Agent did not exit gracefully');
    }),
  ]);
  assert.equal(code, 0);
  assert.ok(!/AttachConsole failed|Error:/.test(stderr), stderr);
  const report = {
    environment: {
      platform: process.platform,
      os: release(),
      logicalCpus: cpus().length,
      node: process.versions.node,
    },
    idle: {
      rssMiB: idle.rss / 1048576,
      cpuPercentOfOneCore: idleCpuPercent,
      sampleSeconds: (idle.time - idleBefore.time) / 1000,
    },
    fourPtys: {
      rssMiB: active.rss / 1048576,
      receivedCharacters: charsWithAck,
      elapsedSeconds: (active.time - outputBefore.time) / 1000,
      cpuSeconds: active.cpuSeconds - outputBefore.cpuSeconds,
    },
    pausedAcknowledgements: {
      receivedCharacters: blockedCharacters,
      rssMiB: blocked.rss / 1048576,
      resumed: true,
    },
    afterClose: { rssMiB: after.rss / 1048576, gracefulExitCode: code },
    limits: {
      unacknowledgedPauseCharacters: 262144,
      hardSessionCharacters: 1048576,
      maxCommandOutputBytes: 65536,
    },
    notes:
      'One local sample of the separate bundled Node process, not a throughput guarantee. Controller and shell child RSS excluded; terminal rendering is not measured.',
  };
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/agent-runtime-benchmark.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  for (const id of sessions) client.disconnect(id);
  if (child.exitCode === null) {
    try {
      await callAgent('agent.shutdown', { confirm: true }, directory);
    } catch {
      child.kill();
    }
    await Promise.race([exited, pause(10000)]);
  }
  await rm(directory, { recursive: true, force: true });
}
