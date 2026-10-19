import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fixture } from '../tests/fixture';

// Run on each native architecture against its packaged executable, not the dev runtime.
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const output = pkg.build.directories.output.replace('${version}', pkg.version);
const executablePath =
  process.env.CSHELL_EXECUTABLE ||
  resolve(
    output,
    process.platform === 'win32'
      ? 'win-unpacked/CShell.exe'
      : process.platform === 'darwin'
        ? `${process.arch === 'arm64' ? 'mac-arm64' : 'mac'}/CShell.app/Contents/MacOS/CShell`
        : `${process.arch === 'arm64' ? 'linux-arm64-unpacked' : 'linux-unpacked'}/canpshell`,
  );
const data = await mkdtemp(join(tmpdir(), 'cshell-package-'));
const server = await fixture();
const env = { ...process.env, CSHELL_TEST_DATA: data, CSHELL_TEST_START_GATE: '1' };
delete env.ELECTRON_RUN_AS_NODE;
let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
const stage = (message: string) => console.log(`[package-smoke ${new Date().toISOString()}] ${message}`);
async function bounded<T>(label: string, operation: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} exceeded ${milliseconds} ms`)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}
const killTestProcess = () => {
  const child = app?.process();
  if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
};
// Also catches orphaned handles after cleanup. This never targets an existing user instance.
const watchdog = setTimeout(() => {
  console.error('Packaged smoke exceeded its total 4 minute deadline');
  killTestProcess();
  server.disconnectAll();
  process.exit(1);
}, 240000);
watchdog.unref();
try {
  stage(`Launching isolated package ${executablePath}`);
  app = await electron.launch({
    executablePath,
    args: [],
    env,
    timeout: 60000,
  });
  assert.equal(
    await bounded('Startup attachment check', app.evaluate(() => (globalThis as any).__cshellPackagedTestAttached), 10000),
    true,
    'The packaged test must attach Chromium before application readiness',
  );
  const page =
    app.context().pages()[0] ?? (await app.context().waitForEvent('page', { timeout: 60000 }));
  page.setDefaultTimeout(20000);
  stage('Chromium attached; waiting for renderer bridge');
  await page.waitForFunction(() => !!window.cshell);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const actual = await bounded('Package metadata', app.evaluate(({ app, BrowserWindow, dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    const prefs = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return {
      version: app.getVersion(),
      arch: process.arch,
      platform: process.platform,
      packaged: app.isPackaged,
      sandbox: prefs.sandbox,
      isolated: prefs.contextIsolation,
    };
  }), 10000);
  assert.equal(actual.version, pkg.version);
  assert.equal(actual.arch, process.arch);
  assert.equal(actual.platform, process.platform);
  assert.ok(actual.packaged && actual.sandbox && actual.isolated);
  stage('Package identity and sandbox verified; connecting fixture SSH');
  await page.getByRole('heading', { name: '尚未连接' }).waitFor();
  await page.getByRole('button', { name: '新建连接', exact: true }).first().click();
  await page.getByRole('button', { name: 'SSH 终端', exact: true }).click();
  const form = page.locator('.connection-editor:visible');
  await form.getByLabel('保存到服务器列表').uncheck();
  await form.getByLabel('主机地址', { exact: true }).fill('127.0.0.1');
  await form.getByLabel('端口', { exact: true }).fill(String(server.port));
  await form.getByLabel('用户名', { exact: true }).fill('tester');
  await form.locator('.connection-secret input').fill(server.password);
  await form.getByRole('button', { name: '连接', exact: true }).click();
  await page.locator('.session-tab').waitFor();
  await page.locator('.xterm-helper-textarea').first().focus();
  const marker = 'package-' + randomUUID();
  await page.keyboard.type(marker);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !!document.querySelector('.xterm-screen'));
  for (let i = 0; i < 100 && !server.shellInputs.join('').includes(marker); i++)
    await new Promise((r) => setTimeout(r, 50));
  assert.ok(server.shellInputs.join('').includes(marker), 'Packaged terminal must transmit input');
  stage('Terminal input verified; opening files');
  await page.locator('.ssh-files-toggle').getByText('文件', { exact: true }).click();
  await page.getByText('hello.txt', { exact: true }).waitFor();
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: `test-results/package-${process.platform}-${process.arch}.png` });
  assert.deepEqual(errors, []);
  console.log(
    `PASS: packaged ${actual.platform}/${actual.arch} ${actual.version}, sandbox, SSH terminal and SFTP`,
  );
} catch (error) {
  console.error('Packaged application failed:', error);
  console.error(
    'Packaged application diagnostics:',
    await bounded('Failure diagnostics', app?.evaluate(({ app, BrowserWindow }) => ({
        ready: app.isReady(),
        windows: BrowserWindow.getAllWindows().map((w) => ({
          visible: w.isVisible(),
          destroyed: w.isDestroyed(),
          url: w.webContents.getURL(),
          loading: w.webContents.isLoading(),
        })),
      })) ?? Promise.resolve(undefined), 5000).catch((diagnosticError) => String(diagnosticError)),
  );
  throw error;
} finally {
  stage('Closing isolated application and fixture');
  try { await bounded('Application close', app?.close() ?? Promise.resolve(), 10000); }
  catch (error) { console.error(error); process.exitCode = 1; killTestProcess(); }
  server.disconnectAll();
  try { await bounded('Fixture close', server.close(), 5000); }
  catch (error) { console.error(error); process.exitCode = 1; }
  try { await bounded('Fixture data removal', rm(data, { recursive: true, force: true, maxRetries: 5 }), 10000); }
  catch (error) { console.error(error); process.exitCode = 1; }
  stage('Cleanup completed');
}
