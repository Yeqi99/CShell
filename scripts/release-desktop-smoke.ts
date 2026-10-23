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

// The pre-0.8.4 smoke assumes terminal/file docks open immediately. Exercise
// the actual machine desktop now, retaining real SSH/SFTP and restart checks.
const data = await mkdtemp(join(tmpdir(), 'cshell-release-084-'));
const server = await fixture();
const env = { ...process.env, CSHELL_TEST_DATA: data };
delete env.ELECTRON_RUN_AS_NODE;
const launch = () => electron.launch({args: process.env.CSHELL_EXECUTABLE ? [] : ['.'],
  ...(process.env.CSHELL_EXECUTABLE ? {executablePath: process.env.CSHELL_EXECUTABLE} : {}), env, timeout: 30000});
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
  await page.locator('.linux-desktop:visible').waitFor();
  assert.equal(await page.locator('.linux-mode-bar').count(),0);
  const auth=page.locator('.saved-connection:visible');
  if(await auth.count()){await auth.locator('input[type=password]').fill(server.password);await auth.locator('input[type=checkbox]').check();await auth.getByRole('button',{name:'连接',exact:true}).click();await auth.waitFor({state:'hidden'});}
  const terminal = await desktopApp(page,'终端');
  await terminal.locator('.xterm-helper-textarea').focus();
  await page.keyboard.type('release-084-history');
  await page.waitForFunction(() => [...document.querySelectorAll('.xterm-rows')].some(el=>el.textContent?.includes('release-084-history')));
  const id = await page.locator('.session-tab.active').getAttribute('data-session');
  assert.ok(id); const requestCount = server.shellRequests();
  await terminal.getByRole('button',{name:'最小化终端',exact:true}).click();
  const files = await desktopApp(page,'文件');
  await files.getByText('hello.txt',{exact:true}).waitFor();
  await files.getByRole('button',{name:'新建目录',exact:true}).click();
  await files.locator('.inline-file-editor input').fill('release-folder');
  await files.locator('.inline-file-editor').getByRole('button',{name:'确认',exact:true}).click();
  await files.getByText('release-folder',{exact:true}).waitFor();
  // Native file picker remains native; only its fixture return value is supplied.
  const source=join(data,'upload.txt'); await writeFile(source,'release 0.8.4 upload');
  await app.evaluate(({dialog}, path) => {dialog.showOpenDialog=(async()=>({canceled:false,filePaths:[path]})) as typeof dialog.showOpenDialog;},source);
  await files.getByRole('button',{name:'上传',exact:true}).click();
  await files.getByText('upload.txt',{exact:true}).waitFor();
  assert.equal(await readFile(join(server.root,'upload.txt'),'utf8'),'release 0.8.4 upload');
  await files.getByText('release-folder',{exact:true}).dblclick();
  await files.getByLabel('路径',{exact:true}).waitFor();
  assert.equal(await files.getByLabel('路径',{exact:true}).inputValue(),'/release-folder');
  await files.getByRole('button',{name:'关闭文件窗口',exact:true}).click();
  await desktopApp(page,'终端');
  assert.equal(server.shellRequests(),requestCount);
  assert.ok(await terminal.locator('.xterm-rows').textContent().then(t=>t?.includes('release-084-history')));
  await terminal.getByRole('button',{name:'最小化终端',exact:true}).click();
  await desktopApp(page,'文件');
  assert.equal(await files.getByLabel('路径',{exact:true}).inputValue(),'/release-folder');
  await page.screenshot({path:'test-results/release-084-desktop.png'});
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
  console.log('PASS 0.8.4 real desktop: layout/settings, encrypted saved SSH, terminal persistence, SFTP upload/create/path, drafts, offline desktop, restart');
} catch(error) {
  console.error(error); const failed=await app.firstWindow().catch(()=>undefined); await failed?.screenshot({path:'test-results/release-084-failed.png'}).catch(()=>{});
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
