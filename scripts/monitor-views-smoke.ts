import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { fixture } from '../tests/fixture';

const server = await fixture(), data = await mkdtemp(join(tmpdir(), 'cshell-views-smoke-'));
const env = { ...process.env, CSHELL_TEST_DATA: data }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.'], env });
try {
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox; });
  const page = await app.firstWindow(); page.setDefaultTimeout(15000);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const viewId = await page.evaluate(async ({ port }) => {
    const profile = { id: crypto.randomUUID(), protocol: 'ssh' as const, name: 'Test machine', host: '127.0.0.1', port, username: 'tester', group: '', favorite: false, auth: 'password' as const };
    await window.cshell.saveProfile(profile);
    const display = (await window.cshell.viewDisplays())[0];
    const id = crypto.randomUUID();
    await window.cshell.saveMonitorView({ id, name: 'Fleet smoke', tiles: [0, 1].map(i => ({
      id: crypto.randomUUID(), profileId: profile.id, label: 'Server ' + (i + 1), kind: 'ssh' as const,
      displayId: 'unplugged-monitor', column: i * 6, row: 0, width: 6, height: 12,
      directory: '/srv/minecraft', command: 'echo explicit-start', screen: i ? 'minecraft' : ''
    })) });
    return id;
  }, { port: server.port });
  await page.getByRole('button', { name: '视图', exact: true }).first().click();
  await page.getByRole('button', { name: '打开 Fleet smoke', exact: true }).click();
  await new Promise<void>(r => { const check = setInterval(() => { if (app.windows().length > 1) { clearInterval(check); r(); } }, 100); setTimeout(() => { clearInterval(check); r(); }, 10000); });
  const view = app.windows().find(w => w !== page)!;
  assert.ok(view); view.on('pageerror', e => errors.push(e.message)); view.setDefaultTimeout(15000);
  const panes = view.locator('.view-tile');
  await panes.nth(1).getByLabel('密码', { exact: true }).fill(server.password);
  await panes.nth(1).getByRole('button', { name: /连接/, exact: false }).last().click();
  await panes.nth(0).getByLabel('密码', { exact: true }).fill(server.password);
  await panes.nth(0).getByRole('button', { name: /连接/, exact: false }).last().click();
  await view.locator('.xterm').nth(1).waitFor();
  await view.waitForTimeout(250);
  assert.equal(server.shellRequests(), 2);
  assert.ok(server.shellInputs.some(s => s.includes("screen -x 'minecraft'")));
  assert.equal(server.shellInputs.filter(s => s.includes('echo explicit-start')).length, 0, 'Opening a view must not execute configured commands');
  await panes.nth(0).getByRole('button', { name: '执行配置命令' }).click();
  await view.waitForTimeout(100);
  assert.ok(server.shellInputs.some(s => s.includes('echo explicit-start')));
  await view.getByRole('button', { name: '调整布局', exact: true }).click();
  await panes.nth(0).locator('.view-tile-title').dragTo(panes.nth(1).locator('.view-tile-title'));
  await view.getByRole('button', { name: '保存布局', exact: true }).click();
  await view.getByText('布局已保存', { exact: true }).waitFor();
  const saved = await page.evaluate(async () => (await window.cshell.monitorViews())[0]);
  assert.equal(saved.tiles[0].column, 6);
  assert.notEqual(saved.tiles[0].displayId, 'unplugged-monitor');
  await view.getByLabel('视图模式', { exact: true }).selectOption('overview');
  await view.getByRole('button', { name: '放大 Server 1', exact: true }).click();
  assert.equal(await view.locator('.view-tile.view-focused').count(), 1);
  const full = await view.locator('.view-grid').boundingBox(), enlarged = await view.locator('.view-tile.view-focused').boundingBox();
  const inset = await view.locator('.view-grid').evaluate(e => {
    const css = getComputedStyle(e);
    return {left:parseFloat(css.paddingLeft),right:parseFloat(css.paddingRight),top:parseFloat(css.paddingTop),bottom:parseFloat(css.paddingBottom)};
  });
  assert.ok(full && enlarged);
  // Focus fills the grid's content box, preserving the same outer gutter as the tiled view.
  assert.ok(Math.abs(enlarged.x - full.x - inset.left) < 1);
  assert.ok(Math.abs(enlarged.y - full.y - inset.top) < 1);
  assert.ok(Math.abs(enlarged.width - (full.width - inset.left - inset.right)) < 1);
  assert.ok(Math.abs(enlarged.height - (full.height - inset.top - inset.bottom)) < 1);
  assert.equal(server.shellRequests(), 2, 'Enlarging a preview must reuse its session');
  await view.getByRole('button', { name: '返回全部预览', exact: true }).click();
  assert.equal(await view.locator('.view-preview-open').count(), 2);
  await view.getByRole('button', { name: '保存布局', exact: true }).click();
  await view.waitForTimeout(100);
  assert.equal(await page.evaluate(async () => (await window.cshell.monitorViews())[0].mode), 'overview');
  await mkdir('test-results', { recursive: true });
  await view.screenshot({ path: 'test-results/monitor-views-smoke.png' });
  await view.locator('.view-pane-close').first().click();
  await view.waitForTimeout(300);
  assert.equal(await view.locator('.view-tile').count(), 1);
  assert.equal(server.connectionsCount(), 1, 'Closing one owned pane must release only that session');
  await view.getByRole('button', { name: '保存布局', exact: true }).click();
  await view.getByText('布局已保存', { exact: true }).waitFor();
  assert.equal(await page.evaluate(async () => (await window.cshell.monitorViews())[0].tiles.length), 1);
  await page.evaluate(id => window.cshell.closeMonitorView(id), viewId);
  await page.waitForTimeout(300);
  assert.equal(server.connectionsCount(), 0, 'View-owned sessions must close with their window');
  await page.evaluate(id => window.cshell.openMonitorView(id), viewId);
  await page.waitForTimeout(500);
  assert.equal(server.shellInputs.filter(s => s.includes('echo explicit-start')).length, 1);
  await page.evaluate(id => window.cshell.closeMonitorView(id), viewId);
  await page.reload();
  await page.locator('.home-connection-list button').first().click();
  const auth = page.locator('.saved-connection:visible');
  await auth.getByLabel('密码', { exact: true }).fill(server.password);
  await auth.getByRole('button', { name: /连接/ }).last().click();
  await page.locator('.xterm').first().waitFor({ state: 'attached' });
  await page.getByRole('button', { name: '工作台', exact: true }).click();
  const before = server.shellRequests();
  await page.locator('.home-mode-options').getByRole('button', { name: /平铺视图/ }).click();
  await page.waitForTimeout(500);
  const currentView = app.windows().find(w => w !== page)!;
  assert.ok(currentView);
  await currentView.getByText('复用工作台会话', { exact: true }).waitFor();
  assert.equal(server.shellRequests(), before, 'Current connection view must not create a second SSH session');
  await currentView.screenshot({ path: 'test-results/current-view-smoke.png' });
  await page.screenshot({ path: 'test-results/workbench-home-smoke.png' });
  await currentView.locator('.view-pane-close').first().click();
  await currentView.locator('.view-empty').waitFor();
  assert.equal(server.connectionsCount(), 1, 'Closing the borrowed pane must preserve the original session');
  await currentView.evaluate(() => window.close());
  await page.waitForTimeout(200);
  assert.equal(server.connectionsCount(), 1, 'Closing a borrowed view must preserve the original connection');
  if (process.platform === 'win32') {
    const localId = await page.evaluate(async () => {
      const id = crypto.randomUUID();
      const displayId = (await window.cshell.viewDisplays())[0].id;
      await window.cshell.saveMonitorView({id,name:'Local terminals',mode:'tile',tiles:['cmd','powershell'].map((shell,i)=>({
        id:crypto.randomUUID(),profileId:'00000000-0000-4000-8000-00000000000'+(i+1),
        label:shell,kind:'local' as const,shell:shell as 'cmd'|'powershell',displayId,column:i*6,row:0,width:6,height:12,directory:'',command:'',screen:'',
      }))});
      await window.cshell.openMonitorView(id);
      return id;
    });
    await page.waitForTimeout(1500);
    const localWindow = app.windows().find(w => w !== page)!;
    await localWindow.locator('.xterm').nth(1).waitFor({state:'attached'});
    await localWindow.locator('.view-terminal textarea').first().focus();
    await localWindow.keyboard.type('echo CSHELL_LOCAL_VIEW_OK');
    await localWindow.keyboard.press('Enter');
    await localWindow.waitForTimeout(300);
    assert.ok((await localWindow.locator('.xterm').first().innerText()).includes('CSHELL_LOCAL_VIEW_OK'));
    await localWindow.locator('.view-terminal textarea').nth(1).focus();
    await localWindow.keyboard.type("Write-Output 'CSHELL_PS_VIEW_OK'");
    await localWindow.keyboard.press('Enter');
    await localWindow.waitForTimeout(2500);
    assert.ok((await localWindow.locator('.xterm').nth(1).innerText()).includes('CSHELL_PS_VIEW_OK'));
    await localWindow.screenshot({path:'test-results/local-terminal-views-smoke.png'});
    await page.evaluate(id => window.cshell.closeMonitorView(id), localId);
  }
  assert.deepEqual(errors, []);
  console.log('PASS: two real SSH panes, explicit command, drag/save, restore, session cleanup');
} finally { await app.close(); await server.close(); await rm(data, { recursive: true, force: true }); }
