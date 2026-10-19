import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture } from '../tests/fixture';
const data = await mkdtemp(join(tmpdir(), 'cshell-navigation-'));
const server = await fixture();
const env = { ...process.env, CSHELL_TEST_DATA: data };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  args: process.env.CSHELL_EXECUTABLE
    ? ['--disable-backgrounding-occluded-windows']
    : ['.', '--disable-backgrounding-occluded-windows'],
  ...(process.env.CSHELL_EXECUTABLE ? { executablePath: process.env.CSHELL_EXECUTABLE } : {}),
  env,
});
try {
  const p = await app.firstWindow();
  p.setDefaultTimeout(15000);
  await app.evaluate(({ BrowserWindow, dialog, ipcMain }) => {
    (globalThis as any).__name = Object;
    BrowserWindow.getAllWindows()[0].setSize(1280, 820);
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    ipcMain.removeHandler('connection:rdp');
    ipcMain.handle('connection:rdp', (_e, v) => {
      (globalThis as any).rdp = v;
    });
  });
  await p.getByRole('button', { name: '新建连接', exact: true }).first().click();
  assert.equal(await p.locator('.connection-editor').count(), 0);
  await mkdir('test-results', { recursive: true });
  await p.screenshot({ path: 'test-results/connection-type-picker.png' });
  await p.getByRole('button', { name: 'Windows 远程桌面', exact: true }).click();
  assert.equal(await p.locator('.connection-editor').count(), 0);
  const rdp = p.locator('.rdp-connect-form');
  await rdp.getByLabel('主机地址').fill('workstation.example');
  await rdp.getByLabel('账号',{exact:true}).fill('tester');
  await rdp.getByRole('button', { name: '保存并连接', exact: true }).click();
  await rdp.getByRole('status').getByText('已保存并打开远程桌面客户端。').waitFor();
  const rdpId=await app.evaluate(() => (globalThis as any).rdp);
  const saved=await p.evaluate(async id=>(await window.cshell.config()).profiles.find(x=>x.id===id),rdpId);
  assert.equal(saved?.host,'workstation.example');assert.equal(saved?.port,3389);
  await p.screenshot({ path: 'test-results/connection-rdp.png' });
  await p.getByRole('button', { name: '返回连接方式' }).click();
  await p.getByRole('button', { name: 'CAgent', exact: true }).click();
  const client = p.locator('.client-connect-form');
  await client.getByLabel('主机地址').fill('client.example');
  assert.equal(await client.getByLabel('名称', { exact: true }).isVisible(), false);
  await p.screenshot({ path: 'test-results/connection-client-compact.png' });
  await p.getByRole('button', { name: '返回连接方式' }).click();
  await p.getByRole('button', { name: 'Windows 远程桌面', exact: true }).click();
  assert.equal(await rdp.getByLabel('主机地址').inputValue(), 'workstation.example');
  await p.getByRole('button', { name: '返回连接方式' }).click();
  await p.getByRole('button', { name: 'SSH 终端', exact: true }).click();
  const form = p.locator('.connection-editor:visible');
  await form.getByLabel('保存到服务器列表').uncheck();
  await form.getByLabel('主机地址').fill('127.0.0.1');
  await form.getByLabel('端口', { exact: true }).fill(String(server.port));
  await form.getByLabel('用户名').fill('tester');
  await form.locator('.connection-secret input').fill(server.password);
  await form.getByRole('button', { name: '连接', exact: true }).click();
  await p.locator('.session-tab').first().waitFor();
  await p.getByRole('button', { name: '插件与应用', exact: true }).click();
  const ext = p.locator('.extension-workbench');
  await ext.locator('.plugin-row').first().waitFor();
  const positions = await ext
    .locator('.plugin-row')
    .evaluateAll((els) =>
      els.map((e) => ({ x: e.getBoundingClientRect().x, y: e.getBoundingClientRect().y })),
    );
  assert.ok(positions[0].y === positions[1].y);
  assert.equal(await ext.locator('.extension-nav-note').count(), 0);
  await p.screenshot({ path: 'test-results/market-grid.png' });
  await ext.getByLabel('搜索插件', { exact: true }).fill('Docker');
  assert.equal(await ext.locator('.plugin-row').count(), 1);
  await ext.getByLabel('搜索插件', { exact: true }).fill('');
  await ext.getByRole('button', { name: '应用市场', exact: true }).click();
  await ext
    .locator('.application-list')
    .getByRole('button', { name: /Python 补全引擎/ })
    .click();
  const detail = ext.locator('.application-detail:visible');
  await detail.getByRole('button', { name: '检查安装条件', exact: true }).waitFor();
  await detail.getByRole('button', { name: '检查安装条件', exact: true }).click();
  await detail.locator('.installation-plan').waitFor();
  const refresh = await ext.getByRole('button', { name: '更新应用目录' }).boundingBox();
  assert.ok(refresh!.height < 45 && refresh!.width < 45);
  const detailBox = await detail.boundingBox();
  assert.ok(detailBox!.y < 300);
  assert.ok(detailBox!.y + detailBox!.height <= 820);
  await p.screenshot({ path: 'test-results/market-app-detail.png' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 700));
  await ext.locator('.application-list').getByRole('button', { name: /Redis/ }).click();
  await detail.getByRole('heading', { name: 'Redis', exact: true }).waitFor();
  assert.ok((await detail.boundingBox())!.y < 480);
  assert.equal(await ext.evaluate((el) => el.scrollWidth > el.clientWidth + 2), false);
  await p.screenshot({ path: 'test-results/market-narrow.png' });
  await app.evaluate(({ BrowserWindow, ipcMain }) => {
    BrowserWindow.getAllWindows()[0].setSize(1280, 820);
    for (const n of [
      'local-terminal:wsl',
      'local-terminal:wsl-network',
      'local-terminal:wsl-network-save',
      'local-terminal:wsl-restart',
    ])
      ipcMain.removeHandler(n);
    let state = {
      revision: 'a'.repeat(64),
      mode: 'nat',
      autoProxy: true,
      localhostProxy: true,
      mirroredSupported: true,
    };
    ipcMain.handle('local-terminal:wsl', () => ({
      available: true,
      distributions: ['Test Linux'],
    }));
    ipcMain.handle('local-terminal:wsl-network', () => state);
    ipcMain.handle('local-terminal:wsl-network-save', (_e, input) => {
      state = { ...state, ...input };
      (globalThis as any).networkSaved = true;
      return state;
    });
    ipcMain.handle('local-terminal:wsl-restart', () => {
      (globalThis as any).networkRestart = true;
      return false;
    });
  });
  await ext.getByRole('button', { name: '插件市场', exact: true }).click();
  const row = ext
    .locator('.plugin-row')
    .filter({ has: p.getByRole('heading', { name: /WSL Linux/ }) });
  await row.getByRole('button', { name: '安装', exact: true }).click();
  await ext.locator('.wsl-network summary').click();
  await ext.getByLabel('网络模式', { exact: true }).selectOption('mirrored');
  await ext.getByRole('button', { name: '保存设置', exact: true }).click();
  await ext.getByRole('status').getByText('已保存，完全重启 WSL 后生效。').waitFor();
  assert.equal(await app.evaluate(() => (globalThis as any).networkRestart), undefined);
  await p.screenshot({ path: 'test-results/wsl-network-settings.png' });
  console.log(
    'PASS: purpose-first connection entry, RDP isolation and drafts, compact markets and visible plans, explicit WSL network save without restart',
  );
} catch (e) {
  console.error(await (await app.firstWindow()).locator('[role=alert]').allTextContents());
  throw e;
} finally {
  await app.close();
  await server.close();
  await rm(data, { recursive: true, force: true, maxRetries: 5 });
}
