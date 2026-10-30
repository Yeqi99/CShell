import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mcpDesktopSmoke } from './mcp-desktop-smoke';

const data = await mkdtemp(join(tmpdir(), 'cshell-mcp-startup-'));
const env = { ...process.env, CSHELL_TEST_DATA: data };
delete env.ELECTRON_RUN_AS_NODE;
const launch = () =>
  electron.launch({
    ...(process.env.CSHELL_EXECUTABLE
      ? { executablePath: process.env.CSHELL_EXECUTABLE, args: [] }
      : { args: ['.'] }),
    env: process.env.CSHELL_EXECUTABLE ? { ...env, CSHELL_TEST_START_GATE: '1' } : env,
  });
let app = await launch();
// Bind the Chromium page directly. Electron's window-to-page bookkeeping can lag
// behind a fast packaged restart even after the native window has loaded.
const firstPage = async () => {
  const page = app.context().pages()[0] ?? (await app.context().waitForEvent('page'));
  await page.waitForFunction(() => !!window.cshell);
  return page;
};
const occupied = createServer();
try {
  await mkdir('test-results', { recursive: true });
  let page = await firstPage();
  page.setDefaultTimeout(15000);
  await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
  await mcpDesktopSmoke(app, page);
  // A real second process must reveal the same hidden/minimized window.
  const executable = await app.evaluate(() => process.execPath);
  for (const action of ['hide', 'minimize'] as const) {
    await app.evaluate(
      ({ BrowserWindow }, action) => BrowserWindow.getAllWindows()[0][action](),
      action,
    );
    const second = spawn(executable, process.env.CSHELL_EXECUTABLE ? [] : ['.'], {
      env,
      stdio: 'ignore',
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        second.kill();
        reject(new Error('Second launch did not exit'));
      }, 30000);
      second.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      second.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    const state = await app.evaluate(({ BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows();
      return {
        count: windows.length,
        visible: windows[0].isVisible(),
        minimized: windows[0].isMinimized(),
      };
    });
    assert.deepEqual(state, { count: 1, visible: true, minimized: false });
  }
  await new Promise<void>((resolve) => occupied.listen(0, '127.0.0.1', resolve));
  const port = (occupied.address() as { port: number }).port;
  const open = async () => {
    await page.locator('.topbar button').last().click();
    await page
      .getByRole('navigation', { name: '设置分类' })
      .getByRole('button', { name: 'AI 与安全', exact: true })
      .click();
  };
  await open();
  const panel = page.locator('.mcp-settings');
  await panel.getByLabel('在本机启用 MCP').check();
  await panel.getByLabel('端口', { exact: true }).fill(String(port));
  await page
    .getByRole('navigation', { name: '设置分类' })
    .getByRole('button', { name: '外观', exact: true })
    .click();
  await page
    .getByRole('navigation', { name: '设置分类' })
    .getByRole('button', { name: 'AI 与安全', exact: true })
    .click();
  assert.equal(await panel.getByLabel('在本机启用 MCP').isChecked(), true);
  await page
    .locator('.settings-savebar')
    .getByRole('button', { name: '保存', exact: true })
    .click();
  await page.locator('.settings-savebar [role=alert]').filter({ hasText: 'is occupied by another application' }).waitFor();
  assert.equal(await panel.getByLabel('在本机启用 MCP').isChecked(), true);
  await panel.getByRole('status').filter({ hasText: /^MCP 已停止$/ }).waitFor();
  await page.screenshot({ path: 'test-results/mcp-save-port-error.png' });
  await new Promise<void>((resolve) => occupied.close(() => resolve()));
  // Retrying an unchanged but failed setting must actually start the service.
  await page
    .locator('.settings-savebar')
    .getByRole('button', { name: '保存', exact: true })
    .click();
  await page.locator('.settings-savebar').waitFor({ state: 'hidden' });
  const stored = JSON.parse(await readFile(join(data, 'config.json'), 'utf8'));
  assert.equal(stored.mcp.enabled, true);
  assert.equal(stored.mcp.port, port);
  await app.close();
  app = await launch();
  page = await firstPage();
  await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
  await open();
  await page.locator('.mcp-settings').getByText('MCP 正在运行', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('在本机启用 MCP').isChecked(), true);
  assert.equal(
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()),
    true,
  );
  await page.screenshot({ path: 'test-results/mcp-save-restart.png' });
  console.log(
    'PASS: footer saves MCP, drafts survive categories, errors remain visible, retry/restart persist, second launch reveals hidden/minimized window',
  );
} catch (error) {
  console.error('Desktop regression failed:', error);
  console.error(
    'Startup diagnostic:',
    await app
      .evaluate(({ app, BrowserWindow }) => ({
        ready: app.isReady(),
        windows: BrowserWindow.getAllWindows().map((w) => ({
          visible: w.isVisible(),
          loading: w.webContents.isLoading(),
          url: w.webContents.getURL(),
        })),
      }))
      .catch((e) => String(e)),
  );
  throw error;
} finally {
  occupied.close();
  await app.close().catch(() => {});
  await rm(data, { recursive: true, force: true });
}
