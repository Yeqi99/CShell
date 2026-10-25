import { _electron as electron } from 'playwright';
import { createServer, type Socket } from 'node:net';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { fixture } from '../tests/fixture';

const data = await mkdtemp(join(tmpdir(), 'cshell-lifecycle-'));
const server = await fixture();
const sockets = new Set<Socket>();
const stalled = createServer((socket) => {
  sockets.add(socket);
  socket.on('error', () => {});
  socket.on('close', () => sockets.delete(socket));
  socket.resume();
});
await new Promise<void>((r) => stalled.listen(0, '127.0.0.1', r));
const port = (stalled.address() as { port: number }).port;
const env = { ...process.env, CSHELL_TEST_DATA: data };
delete env.ELECTRON_RUN_AS_NODE;
let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
let currentStage = 'startup';
const stage = (message: string) => { currentStage = message; console.log('[lifecycle '+new Date().toISOString()+'] '+message); };
async function bounded<T>(label: string, operation: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([operation, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(label+' exceeded '+milliseconds+' ms at '+currentStage)), milliseconds);
  })]); } finally { clearTimeout(timer); }
}
const killIsolatedApp = () => {
  const child = app?.process();
  if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
};
// The unreferenced watchdog also detects orphan handles after cleanup; it never targets a user instance.
const watchdog = setTimeout(() => {
  console.error('Lifecycle smoke exceeded 4 minutes at '+currentStage);
  killIsolatedApp(); server.disconnectAll();
  for (const socket of sockets) socket.destroy();
  process.exit(1);
}, 240000);
watchdog.unref();
async function settled(predicate: () => boolean) {
  for (let i = 0; i < 300; i++) {
    if (predicate()) return;
    await delay(10);
  }
  assert.fail('Socket did not settle at '+currentStage+'; stalled='+sockets.size+' SSH='+server.connectionsCount());
}
try {
  stage('launch isolated app');
  app = await electron.launch({
  args: process.env.CSHELL_EXECUTABLE ? [] : ['.'],
  ...(process.env.CSHELL_EXECUTABLE ? { executablePath: process.env.CSHELL_EXECUTABLE } : {}),
  env, timeout: 30000,
});
  const runningApp = app;
  await bounded('Lifecycle scenario', (async () => {
  const page = await runningApp.firstWindow();
  page.setDefaultTimeout(15000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  stage('initial UI and temporary cancellation');
  await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
  await runningApp.evaluate(({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as any;
  });
  await page.getByRole('button', { name: '新建连接', exact: true }).first().click();
  await page.getByRole('button', { name: 'SSH 终端', exact: true }).click();
  const form = page.locator('.connection-editor:visible');
  await form.getByLabel('保存到服务器列表').uncheck();
  await form.getByLabel('主机地址').fill('127.0.0.1');
  await form.getByLabel('端口', { exact: true }).fill(String(port));
  await form.getByLabel('用户名', { exact: true }).fill('tester');
  await form.getByRole('button', { name: '连接', exact: true }).click();
  await settled(() => sockets.size === 1);
  await form.getByRole('button', { name: '取消连接', exact: true }).click();
  await form.getByText('已取消连接。', { exact: true }).waitFor();
  await settled(() => sockets.size === 0);
  assert.equal(await page.locator('.session-tab').count(), 0);
  assert.equal(await form.getByLabel('主机地址').inputValue(), '127.0.0.1');
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/connection-cancel-light.png' });

  stage('workspace switch and close pending editor');
  // Changing workspaces must not cancel the attempt; closing its tab must cancel it.
  await form.getByRole('button', { name: '连接', exact: true }).click();
  await settled(() => sockets.size === 1);
  await page.getByRole('button', { name: '偏好设置', exact: true }).first().click();
  assert.equal(sockets.size, 1);
  await page.getByRole('button', { name: '关闭连接编辑 · 放弃未保存修改', exact: true }).click();
  await settled(() => sockets.size === 0);
  assert.equal(await page.locator('.session-tab').count(), 0);
  assert.equal(await page.locator('.toast').count(), 0);

  stage('saved connection cancellation');
  // Saved connections must remain closeable while authentication is pending.
  const target = {
    id: randomUUID(),
    name: 'Cancel saved',
    host: '127.0.0.1',
    port,
    username: 'tester',
    auth: 'password' as const,
    group: '',
    favorite: false,
  };
  await page.evaluate((p) => window.cshell.saveProfile(p), target);
  await page.reload();
  await page.locator('.server-open').filter({ hasText: target.name }).dblclick();
  const auth = page.locator('.saved-connection:visible');
  await auth.getByLabel('密码', { exact: true }).fill('test');
  await auth.getByRole('button', { name: '连接', exact: true }).click();
  await settled(() => sockets.size === 1);
  await page
    .locator('.tabs')
    .getByRole('button', { name: '关闭 ' + target.name, exact: true })
    .click();
  await settled(() => sockets.size === 0);
  assert.equal(await page.locator('.session-tab').count(), 0);

  stage('real terminal and retained scrollback');
  // Connect temporarily through the real form and type into the real terminal.
  await page.getByRole('button', { name: '新建连接', exact: true }).first().click();
  await page.getByRole('button', { name: 'SSH 终端', exact: true }).click();
  await form.getByLabel('保存到服务器列表').uncheck();
  await form.getByLabel('主机地址').fill('127.0.0.1');
  await form.getByLabel('端口', { exact: true }).fill(String(server.port));
  await form.getByLabel('用户名', { exact: true }).fill('tester');
  await form.locator('.connection-secret input').fill(server.password);
  await form.getByRole('button', { name: '连接', exact: true }).click();
  await page.locator('.session-tab').waitFor();
  const firstId = await page.locator('.session-tab').getAttribute('data-session');
  await page.locator('.terminals:visible .xterm-helper-textarea:visible').waitFor();
  assert.equal(await page.locator('.linux-desktop:visible').count(),0);
  assert.equal((await page.evaluate(()=>window.cshell.config())).preferences.defaultConnectionView,'original');
  const firstShellCount=server.shellRequests();
  await page.getByRole('button',{name:'打开可视化桌面',exact:true}).click();
  await page.locator('.linux-desktop:visible .desktop-icons').getByRole('button',{name:'终端',exact:true}).dblclick();
  assert.equal(server.shellRequests(),firstShellCount);
  const terminal = page.locator('.terminal-host:visible');
  await terminal.locator('textarea').focus();
  await page.keyboard.type('history-marker');
  await page.keyboard.press('Enter');
  await settled(() => server.shellInputs.join('').includes('history-marker'));
  await terminal.locator('.xterm-rows').filter({ hasText: 'history-marker' }).waitFor();
  const sent = server.shellInputs.join('');
  await page.getByRole('button', { name: '偏好设置', exact: true }).first().click();
  server.disconnectAll();
  await page.locator('.session-tab .dot.off').waitFor();
  assert.equal(await page.locator('.disconnected-session-bar:visible').count(), 0);
  assert.equal(await page.locator('.toast').count(), 0);
  await page.locator('.session-tab').getByRole('button').first().click();
  await page.getByRole('button',{name:'连接已断开，重试',exact:true}).waitFor();
  assert.equal(await page.locator('.monitor-panel:visible').count(), 0);
  await page.screenshot({ path: 'test-results/connection-disconnected-light.png' });
  await page.getByRole('button', { name: '连接已断开，重试', exact: true }).click();
  await auth.getByLabel('密码', { exact: true }).fill(server.password);
  assert.equal(await page.locator('.connection-editor:visible').count(), 0);
  assert.equal(await auth.getByRole('checkbox').count(), 0);
  await auth.getByRole('button', { name: '连接', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.session-tab').length === 2);
  assert.equal(server.shellInputs.join(''), sent);
  const config = await page.evaluate(() => window.cshell.config());
  assert.equal(config.profiles.length, 1);
  assert.equal(config.savedCredentials.length, 0);
  await page.locator(`.session-tab[data-session="${firstId}"]`).getByRole('button').first().focus();
  await page.locator(`.session-tab[data-session="${firstId}"]`).getByRole('button').first().click();
  stage('old scrollback search and theme');
  // Search retained scrollback through xterm's actual search UI.
  await page.keyboard.press('Control+Shift+F');
  const search = page.locator('.terminal-search:visible input');
  await search.fill('history-marker');
  await page.keyboard.press('Enter');
  await terminal.locator('.xterm-selection div').first().waitFor({ state: 'attached' });
  assert.equal((await terminal.locator('.xterm-selection div').count()) > 0, true);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '切换为深色', exact: true }).click();
  await runningApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 640));
  await page.screenshot({ path: 'test-results/connection-disconnected-dark.png' });
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: real desktop cancellation, close during connection, hidden attempt retained, scoped disconnect, temporary reconnect, old scrollback retained, no replay or secret persistence, light/dark compact layouts',
  );
  })(), 180000);
} catch (error) {
  console.error('Lifecycle failed at '+currentStage+'; stalled='+sockets.size+' SSH='+server.connectionsCount());
  await mkdir('test-results', {recursive:true});
  const page = app?.windows()[0];
  if (page) await bounded('Failure screenshot', page.screenshot({path:'test-results/connection-lifecycle-failure.png',timeout:5000}),6000).catch(e=>console.error(String(e)));
  throw error;
} finally {
  stage('cleanup isolated app');
  // Tear down fixture sockets before app quit so a stalled SSH handshake cannot delay shutdown.
  server.disconnectAll();
  for (const socket of sockets) socket.destroy();
  try { await bounded('Application close', app?.close() ?? Promise.resolve(), 10000); }
  catch (error) { console.error(error); process.exitCode=1; killIsolatedApp(); }
  stage('cleanup fixture');
  try { await bounded('SSH fixture close', server.close(), 5000); }
  catch (error) { console.error(error); process.exitCode=1; }
  try { await bounded('Stalled server close', new Promise<void>(resolve=>stalled.close(()=>resolve())),5000); }
  catch (error) { console.error(error); process.exitCode=1; }
  try { await bounded('Test data cleanup', rm(data,{recursive:true,force:true,maxRetries:5}),10000); }
  catch (error) { console.error(error); process.exitCode=1; }
  stage('cleanup completed');
}
