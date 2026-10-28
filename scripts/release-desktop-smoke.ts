import { _electron as electron, type Page } from 'playwright';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fixture } from '../tests/fixture';
import { workspaceSmoke } from './workspace-smoke';
import { designSmoke } from './design-smoke';
import { groupsSmoke } from './groups-smoke';
import { appearanceSmoke } from './appearance-smoke';
import { mcpDesktopSmoke } from './mcp-desktop-smoke';

// Validate the native SSH default first, then explicitly open its visual
// workspace without replacing the real PTY, scrollback or file context.
const data = await mkdtemp(join(tmpdir(), 'cshell-release-desktop-'));
const server = await fixture();
const env = { ...process.env, CSHELL_TEST_DATA: data, CSHELL_TEST_START_GATE:'1' };
delete env.ELECTRON_RUN_AS_NODE;
const launch = async () => {const application=await electron.launch({args: process.env.CSHELL_EXECUTABLE ? [] : ['.'],
  ...(process.env.CSHELL_EXECUTABLE ? {executablePath: process.env.CSHELL_EXECUTABLE} : {}), env, timeout: 30000});await application.evaluate(()=>{(globalThis as any).__cshellPackagedTestAttached=true;});return application;};
let app = await launch();
const errors: string[] = [];
async function desktopApp(page: Page, name: string) {
  const desktop = page.locator('.linux-desktop:visible');
  const task = desktop.getByRole('button', {name: '切换到' + name, exact: true});
  if (await task.count()) { if(await task.getAttribute('aria-pressed')!=='true') await task.click(); }
  else await desktop.locator('.desktop-icons').getByRole('button', {name, exact: true}).dblclick();
  return desktop.getByRole('region', {name: name + '窗口', exact: true});
}
try {
  await mkdir('test-results', {recursive:true});
  const page = await app.firstWindow(); page.setDefaultTimeout(20000);
  page.on('pageerror', e => errors.push(e.message));
  await page.getByRole('heading', {name:'工作台', exact:true}).waitFor();
  assert.equal((await page.evaluate(()=>window.cshell.config())).preferences.defaultConnectionView,'original');
  await workspaceSmoke(page); await designSmoke(app, page);
  await page.getByRole('button', {name:'新建连接', exact:true}).first().click();
  await page.getByRole('button', {name:'SSH 终端', exact:true}).click();
  const form = page.locator('.connection-editor:visible');
  await form.getByLabel('保存到服务器列表').check();
  await form.getByLabel('名称', {exact:true}).fill('Local integration');
  await form.getByLabel('主机地址').fill('127.0.0.1');
  await form.getByLabel('端口', {exact:true}).fill(String(server.port));
  await form.getByLabel('用户名', {exact:true}).fill('tester');
  await form.locator('.connection-secret input').fill(server.password);
  await form.getByLabel('使用系统加密保存凭据').check();
  await form.getByRole('button', {name:'仅保存', exact:true}).click();
  await groupsSmoke(page);
  await appearanceSmoke(app, page, data);
  await mcpDesktopSmoke(app, page);
  await app.evaluate(({dialog}) => {dialog.showMessageBox = (async () => ({response:1,checkboxChecked:false})) as typeof dialog.showMessageBox;});
  await page.locator('.server-open').filter({hasText:'Local integration'}).dblclick();
  const auth=page.locator('.saved-connection:visible');
  if(await auth.count()){await auth.locator('input[type=password]').fill(server.password);await auth.locator('input[type=checkbox]').check();await auth.getByRole('button',{name:'连接',exact:true}).click();await auth.waitFor({state:'hidden'});}
  const nativeInput=page.locator('.terminals:visible .xterm-helper-textarea:visible');await nativeInput.waitFor();
  assert.equal(await page.locator('.linux-desktop:visible').count(),0);
  await nativeInput.evaluate(el=>{(window as any).__releaseTerminalInput=el;});await nativeInput.focus();
  await page.keyboard.type('release-desktop-history');
  await page.waitForFunction(() => [...document.querySelectorAll('.xterm-rows')].some(el=>el.textContent?.includes('release-desktop-history')));
  const id = await page.locator('.session-tab.active').getAttribute('data-session');
  assert.ok(id); const requestCount = server.shellRequests();
  await page.getByLabel('桌面与显示方式',{exact:true}).click();await page.getByRole('menuitem',{name:'CShell 可视化桌面',exact:true}).click();
  await page.locator('.linux-desktop:visible').waitFor();assert.equal(await page.locator('.linux-mode-bar').count(),0);
  const terminal = await desktopApp(page,'终端');await terminal.locator('.xterm-helper-textarea:visible').waitFor();
  assert.equal(server.shellRequests(),requestCount);
  assert.equal(await terminal.locator('.xterm-helper-textarea').evaluate(el=>el===(window as any).__releaseTerminalInput),true,'visual view reuses the native terminal node');
  assert.ok((await terminal.locator('.xterm-rows').textContent())?.includes('release-desktop-history'));
  await terminal.getByRole('button',{name:'最小化终端',exact:true}).click();
  const files = await desktopApp(page,'文件');
  await files.getByText('hello.txt',{exact:true}).waitFor();
  await files.getByRole('button',{name:'新建目录',exact:true}).click();
  await files.locator('.inline-file-editor input').fill('release-folder');
  await files.locator('.inline-file-editor').getByRole('button',{name:'确认',exact:true}).click();
  await files.getByText('release-folder',{exact:true}).waitFor();
  // Native file picker remains native; only its fixture return value is supplied.
  const source=join(data,'upload.txt'); await writeFile(source,'release desktop upload');
  await app.evaluate(({dialog}, path) => {dialog.showOpenDialog=(async()=>({canceled:false,filePaths:[path]})) as typeof dialog.showOpenDialog;},source);
  await files.getByRole('button',{name:'上传',exact:true}).click();
  await files.getByText('upload.txt',{exact:true}).waitFor();
  assert.equal(await readFile(join(server.root,'upload.txt'),'utf8'),'release desktop upload');
  await files.getByText('release-folder',{exact:true}).dblclick();
  await page.waitForFunction(input => input?.value === '/release-folder', await files.getByLabel('路径',{exact:true}).elementHandle());
  assert.equal(await files.getByLabel('路径',{exact:true}).inputValue(),'/release-folder');
  await files.getByRole('button',{name:'关闭文件窗口',exact:true}).click();
  await desktopApp(page,'终端');
  assert.equal(server.shellRequests(),requestCount);
  assert.ok(await terminal.locator('.xterm-rows').textContent().then(t=>t?.includes('release-desktop-history')));
  await terminal.getByRole('button',{name:'最小化终端',exact:true}).click();
  await desktopApp(page,'文件');
  assert.equal(await files.getByLabel('路径',{exact:true}).inputValue(),'/release-folder');
  await page.screenshot({path:'test-results/release-desktop.png'});
  await page.getByRole('button',{name:'新建连接',exact:true}).first().click();
  await page.getByRole('button',{name:'SSH 终端',exact:true}).click();
  const draft=page.locator('.connection-editor:visible');
  await draft.getByLabel('主机地址').fill('draft.example.invalid');
  await page.locator(`[data-session="${id}"]`).click();
  await desktopApp(page,'终端');
  await terminal.locator('.xterm-helper-textarea').focus(); await page.keyboard.type('after-draft');
  await page.locator('.tabs').getByRole('button',{name:'新建连接',exact:true}).focus();
  await page.locator('.tabs').getByRole('button',{name:'新建连接',exact:true}).click();
  assert.equal(await draft.getByLabel('主机地址').inputValue(),'draft.example.invalid');
  await page.getByRole('button',{name:'关闭连接编辑 · 放弃未保存修改',exact:true}).click();
  await server.disconnectAll();
  await page.getByRole('button',{name:'连接已断开，重试',exact:true}).waitFor();
  await page.locator('.linux-desktop:visible').waitFor();
  assert.deepEqual(errors,[]);
  await app.evaluate(({app})=>app.exit(0)); await app.close(); app=await launch();
  const restarted=await app.firstWindow();
  await restarted.waitForFunction(async()=> (await window.cshell.config()).profiles.some(p=>p.name==='Local integration'));
  const config=await restarted.evaluate(()=>window.cshell.config());
  assert.ok(config.savedCredentials.length); assert.ok(config.groups.includes('Empty group'));
  assert.equal(config.preferences.backgroundOpacity,0.3);
  assert.equal(config.preferences.defaultConnectionView,'original','one explicit view switch never changes the default');
  console.log('PASS real desktop: native SSH default, explicit visual view with the same PTY/input/history, layout/settings, encrypted saved SSH, SFTP upload/create/path, drafts, offline desktop, restart');
} catch(error) {
  console.error(error); const failed=await app.firstWindow().catch(()=>undefined); await failed?.screenshot({path:'test-results/release-desktop-failed.png'}).catch(()=>{});
  throw error;
} finally {
  // Bound cleanup of this isolated fixture even if Electron's inspector stops responding.
  const fixtureProcess = app.process();
  const cleanup = setTimeout(() => {
    // On Windows Playwright owns a cmd wrapper; kill its fixture tree, not just the wrapper.
    if (process.platform === 'win32' && fixtureProcess.pid)
      execFile('taskkill', ['/PID', String(fixtureProcess.pid), '/T', '/F'], () => {});
    else fixtureProcess.kill();
  }, 10000);
  try {
    await app.evaluate(({app})=>app.exit(0)).catch(()=>{}); await app.close().catch(()=>{});
  } finally { clearTimeout(cleanup); }
  await server.close(); await rm(data,{recursive:true,force:true});
}
