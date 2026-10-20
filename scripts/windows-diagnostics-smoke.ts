import { _electron as electron } from 'playwright';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const directory = await mkdtemp(join(tmpdir(), 'cshell-diagnostic-smoke-'));
const env = { ...process.env, CSHELL_TEST_DATA: directory };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.'], env });
try {
  const page = await app.firstWindow();
  await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
  await page.evaluate(async () => {
    window.dispatchEvent(new ErrorEvent('error', { message: 'DIAGNOSTIC_RENDERER_TEST password=secret-canary' }));
    try { await window.cshell.monitor('invalid-fixture-id'); } catch {}
  });
  await app.evaluate(({ shell }) => { shell.openPath = async path => { (globalThis as any).diagnosticOpened = path; return ''; }; });
  await page.evaluate(() => window.cshell.openDiagnostics());
  const opened = await app.evaluate(() => (globalThis as any).diagnosticOpened);
  assert.equal(opened, join(directory, 'logs'));
  const log = await readFile(join(directory, 'logs', 'runtime.jsonl'), 'utf8');
  assert(log.includes('DIAGNOSTIC_RENDERER_TEST'));
  assert(log.includes('ipc.monitor'));
  assert(!log.includes('secret-canary'));
  await writeFile('test-results/windows-diagnostics-smoke.json', JSON.stringify({passed:true,renderer:true,ipc:true,redaction:true,folder:true}));
  console.log('PASS actual Electron renderer, IPC diagnostics and local log folder');
} finally { await app.close(); }
