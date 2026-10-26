import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const executable = process.env.CSHELL_EXECUTABLE || require('electron') as string;
const appPath = resolve(process.env.CSHELL_APP_PATH || '.');
const root = await mkdtemp(join(tmpdir(), 'cshell-desktop-provision-smoke-'));
const data = join(root, 'data'), plan = join(root, 'plan.json');
const config = { format: 'cshell-deployment-1', target: 'cshell', extensions: [{ id: 'cshell.classroom', enabled: true }] };
const env = { ...process.env, CSHELL_TEST_DATA: data, APPDATA: join(root, 'roaming'), LOCALAPPDATA: join(root, 'local') };
delete env.ELECTRON_RUN_AS_NODE;delete env.CSHELL_TEST_START_GATE;
async function run(apply: boolean) {
  const args = [...(process.env.CSHELL_EXECUTABLE ? [] : [appPath]), '--provision-file', plan, ...(apply ? ['--apply'] : []), '--provision-only'];
  return new Promise<{ code: number | null; result: Record<string, any> | null }>((resolveRun, reject) => {
    const child = spawn(executable, args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';const timeout = setTimeout(() => { child.kill();reject(new Error('Isolated provisioning process timed out')); }, 20000);
    child.stdout.on('data', chunk => { output += chunk.toString();if (output.length > 100000) child.kill(); });child.stderr.resume();
    child.on('error', e => { clearTimeout(timeout);reject(e); });
    child.on('close', code => { clearTimeout(timeout);const line = output.split(/\r?\n/).find(s => s.startsWith('{') && s.includes('"applied"'));
      resolveRun({ code, result: line ? JSON.parse(line) : null }); });
  });
}
try {
  await mkdir(env.APPDATA, { recursive: true });await mkdir(env.LOCALAPPDATA, { recursive: true });await writeFile(plan, JSON.stringify(config));
  const preview = await run(false);assert.equal(preview.code, 0);assert.equal(preview.result?.applied, false);assert.equal(preview.result?.plan?.screenSharingStarted, false);
  await assert.rejects(readFile(join(data, 'config.json')));
  const applied = await run(true);assert.equal(applied.code, 0);assert.equal(applied.result?.applied, true);
  assert.equal(applied.result?.plan.screenSharingStarted, false);assert.equal(applied.result?.plan.capabilityExecutionGranted, false);
  const bytes = await readFile(join(data, 'config.json'));const stored = JSON.parse(bytes.toString());
  assert.deepEqual(stored.plugins.map((p: any) => [p.manifest.id, p.enabled]), [['cshell.classroom', true]]);
  assert.equal(stored.mcp.enabled, false);assert.equal(stored.mcp.allowCommands, false);assert.deepEqual(stored.mcp.allowedProfiles, []);
  assert.deepEqual(stored.profiles, []);assert.deepEqual(stored.secrets, {});assert.deepEqual(stored.hosts, {});
  assert.equal((await readdir(data)).some(n => /ai|account|cloud|session/i.test(n) && n !== 'Session Storage'), false);
  await writeFile(join(data, 'account-preservation-fixture.bin'), 'opaque-existing-data');
  await writeFile(plan, JSON.stringify({ ...config, extensions: [] }));
  const repeat = await run(true);assert.equal(repeat.code, 0);assert.equal(repeat.result?.existingDataPreserved, true);
  assert.deepEqual(await readFile(join(data, 'config.json')), bytes);assert.equal(await readFile(join(data, 'account-preservation-fixture.bin'), 'utf8'), 'opaque-existing-data');
  await writeFile(plan, JSON.stringify({ ...config, permissions: { everything: true } }));
  const invalid = await run(true);assert.equal(invalid.code, 1);assert.deepEqual(await readFile(join(data, 'config.json')), bytes);
  const receipt = { checkedAt: new Date().toISOString(), executable, appPath, realElectron: true, preview: true, onlyRequestedExtension: true,
    noSharingOrExecutionGrant: true, existingBytesPreserved: true, invalidAuthorityRejected: true, isolatedDataRemoved: true };
  await mkdir('.local', { recursive: true });await writeFile('.local/desktop-provisioning-smoke.json', JSON.stringify(receipt, null, 2));console.log(JSON.stringify(receipt));
} finally { await rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 }); }
