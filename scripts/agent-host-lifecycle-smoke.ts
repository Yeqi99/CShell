import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { callAgent } from '../src/agent/control';

// Keep stdin open like the native window does. A runtime shutdown must still
// release this process; force-killing the fixture is cleanup, never success.
const staged = resolve(process.argv[2]);
await access(join(staged, 'agent.cjs'));
await access(join(staged, process.platform === 'win32' ? 'node.exe' : 'node'));
const directory = await mkdtemp(join(tmpdir(), 'cagent-host-exit-'));
const child = spawn(join(staged, process.platform === 'win32' ? 'node.exe' : 'node'),
  [join(staged, 'agent.cjs'), 'app-host'], {
    env: { ...process.env, CSHELL_AGENT_DATA: directory },
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
let output = '', hostReady = false;
child.stdout.on('data', bytes => {
  output = (output + String(bytes)).slice(-8192);
  for (const line of output.split('\n')) {
    try { if (typeof JSON.parse(line).url === 'string') hostReady = true; } catch { /* incomplete line */ }
  }
});
let stages = '', diagnostic = '';
child.stderr.on('data', bytes => {
  diagnostic = (diagnostic + String(bytes)).slice(-4000);
  for (const line of String(bytes).split('\n')) if (line.startsWith('[close-stage]')) stages += line + '\n';
});
const exited = new Promise<number | null>((resolve, reject) => {
  child.once('exit', resolve); child.once('error', reject);
});
void exited.catch(() => {}); // Readiness polling must not create an unhandled rejection.
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
try {
  let ready = false;
  for (let i = 0; i < 300; i++) {
    try {
      await callAgent('client.status', undefined, directory);
      if (hostReady) { ready = true; break; }
      await sleep(100);
    }
    catch { if (child.exitCode !== null) break; await sleep(100); }
  }
  if (!ready) console.error(diagnostic.replace(/https?:\/\/\S+/g, '[local URL]'));
  assert.ok(ready, 'isolated app-host must start');
  // A second native window attaches to the same runtime. Closing its pipe
  // must release only its UI host, not the runtime owned by the first window.
  const second = spawn(join(staged, process.platform === 'win32' ? 'node.exe' : 'node'),
    [join(staged, 'agent.cjs'), 'app-host'], {
      env: { ...process.env, CSHELL_AGENT_DATA: directory },
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
  let secondReady = false, secondOutput = '';
  second.stdout.on('data', bytes => {
    secondOutput = (secondOutput + String(bytes)).slice(-8192);
    for (const line of secondOutput.split('\n')) {
      try { if (typeof JSON.parse(line).url === 'string') secondReady = true; } catch {}
    }
  });
  second.stderr.resume();
  const secondExit = new Promise<number | null>((resolve, reject) => {
    second.once('exit', resolve); second.once('error', reject);
  });
  void secondExit.catch(() => {});
  try {
    for (let i = 0; i < 100 && !secondReady && second.exitCode === null; i++) await sleep(100);
    assert.ok(secondReady, 'secondary app-host must attach');
    second.stdin.end();
    const detached = await Promise.race([secondExit.then(code => ({code})), sleep(5000).then(() => null)]);
    assert.ok(detached, 'secondary app-host must exit when its owner closes');
    assert.equal(detached.code, 0);
    await callAgent('client.status', undefined, directory);
    assert.equal(child.exitCode, null, 'closing secondary UI must preserve primary runtime');
  } finally {
    second.stdin.end();
    if (second.exitCode === null) second.kill();
    await secondExit.catch(() => {});
  }
  await callAgent('agent.shutdown', { confirm: true }, directory);
  const outcome = await Promise.race([exited.then(code => ({ code })), sleep(5000).then(() => null)]);
  if (!outcome && stages) console.error(stages);
  assert.ok(outcome, 'app-host must exit after shutdown even while its owner keeps stdin open');
  assert.equal(outcome.code, 0);
  console.log('PASS: app-host exits after authenticated shutdown with open owner stdin');
} finally {
  child.stdin.end();
  if (child.exitCode === null) child.kill();
  await exited.catch(() => {});
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
