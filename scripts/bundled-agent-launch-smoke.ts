import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { callAgent, discoverAgent } from '../src/agent/control';

const execFileAsync = promisify(execFile);
// PowerShell 7's module path must not leak into Windows PowerShell 5.1.
const powershellEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'psmodulepath'));
const exec = (file: string, args: string[], options: { windowsHide: boolean }) => execFileAsync(file, args, { ...options, env: powershellEnv });
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const packaged = resolve(process.argv[2] ?? `release/${version}/win-unpacked`);
const resources = join(packaged, 'resources/cagent');
const info = JSON.parse(await readFile(join(resources, 'build-info.json'), 'utf8'));
assert.equal(info.version, version);
assert.equal(info.electron, false);
const fixture = await mkdtemp(join(tmpdir(), 'cshell-bundled-launch-'));
const directory = join(fixture, 'agent');
type ProcessRecord = { ProcessId: number; ParentProcessId: number; ExecutablePath: string; CreationDate: string };
async function processRecord(pid: number): Promise<ProcessRecord | undefined> {
  assert.ok(Number.isSafeInteger(pid) && pid > 0);
  const { stdout } = await exec('powershell.exe', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" | Select-Object ProcessId,ParentProcessId,ExecutablePath,@{n='CreationDate';e={$_.CreationDate.ToString('o')}} | ConvertTo-Json -Compress`], { windowsHide: true });
  return stdout.trim() ? JSON.parse(stdout) : undefined;
}
const env = { ...process.env, CSHELL_TEST_DATA: join(fixture, 'cshell'), CSHELL_AGENT_DATA: directory, CSHELL_TEST_START_GATE: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const owned: ProcessRecord[] = [];
const app = await electron.launch({ executablePath: join(packaged, 'CShell.exe'), args: [], env });
let report: Record<string, unknown> = { ok: false, version, isolated: true, publicNetworkTested: false };
try {
  const page = app.context().pages()[0] ?? await app.context().waitForEvent('page');
  await page.waitForFunction(() => !!window.cshell);
  await page.evaluate(async () => {
    await window.cshell.pluginInstall('cshell.agent');
    await window.cshell.pluginToggle('cshell.agent', true);
    const targets = await window.cshell.agentTargets();
    if (!targets.find(t => t.id === 'local')?.bundledApp) throw Error('Packaged CAgent is unavailable');
    await window.cshell.agentLaunch();
  });
  // Track the native launcher even if its runtime fails before publishing discovery.
  const electronPid = await app.evaluate(() => process.pid);
  assert.ok(Number.isSafeInteger(electronPid));
  const { stdout: children } = await exec('powershell.exe', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter "ParentProcessId=${electronPid}" | Select-Object -ExpandProperty ProcessId | ConvertTo-Json -Compress`], { windowsHide: true });
  const childIds: number[] = children.trim() ? [JSON.parse(children)].flat() : [];
  for (const pid of childIds) {
    const record = await processRecord(pid);
    if (record?.ExecutablePath?.toLowerCase() === join(resources, 'Cagent.exe').toLowerCase()) owned.push(record);
  }
  const deadline = Date.now() + 30000;
  let endpoint;
  while (Date.now() < deadline) {
    endpoint = await discoverAgent(directory);
    if (endpoint) break;
    await new Promise(r => setTimeout(r, 200));
  }
  assert.ok(endpoint, 'Launched CAgent did not publish isolated discovery');
  const runtime = await processRecord(endpoint.pid);
  assert.ok(runtime);
  assert.equal(runtime.ExecutablePath.toLowerCase(), join(resources, 'node.exe').toLowerCase());
  owned.push(runtime);
  const windowProcess = await processRecord(runtime.ParentProcessId);
  assert.ok(windowProcess);
  assert.equal(windowProcess.ExecutablePath.toLowerCase(), join(resources, 'Cagent.exe').toLowerCase());
  assert.equal(windowProcess.ParentProcessId, electronPid);
  if (!owned.some(p => p.ProcessId === windowProcess.ProcessId)) owned.push(windowProcess);
  const status = await callAgent('client.status', undefined, directory);
  const desktop = await callAgent('desktop.status', undefined, directory);
  assert.equal(status.running, false);
  assert.equal(status.passwordConfigured, false);
  for (const field of ['allowManage', 'allowHttp', 'allowHosting', 'allowRelay']) assert.equal(status[field], false);
  assert.equal(desktop.listening, false);
  assert.equal(desktop.config.enabled, false);
  assert.equal(desktop.viewAllowed, false);
  assert.equal(desktop.controlAllowed, false);
  assert.equal(desktop.packageReady, false);
  assert.equal(desktop.nativeAvailable, true);
  report = { ...report, ok: true, source: 'win-unpacked/resources/cagent', ipc: 'agent:launch', runtimePid: runtime.ProcessId, nativeWindowPid: windowProcess.ProcessId, defaultRemoteListener: false, defaultDesktopListener: false, defaultGrants: false, bundledDesktopPresent: true };
} catch (error) {
  report.error = String(error);
  throw error;
} finally {
  if (owned.length) await callAgent('agent.shutdown', { confirm: true }, directory).catch(() => undefined);
  for (const record of owned.reverse()) {
    const current = await processRecord(record.ProcessId);
    if (!current || current.CreationDate !== record.CreationDate || current.ExecutablePath !== record.ExecutablePath) continue;
    await exec('powershell.exe', ['-NoProfile', '-Command', `$p=Get-Process -Id ${record.ProcessId} -ErrorAction SilentlyContinue; if($p){[void]$p.CloseMainWindow()}`], { windowsHide: true });
    await new Promise(r => setTimeout(r, 500));
    const remaining = await processRecord(record.ProcessId);
    if (remaining?.CreationDate === record.CreationDate) process.kill(record.ProcessId);
  }
  await app.close();
  report.fixtureProcessesCleaned = true;
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/bundled-agent-launch-smoke.json', JSON.stringify(report, null, 2));
}


