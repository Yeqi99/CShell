import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { fixture } from '../tests/fixture';
const data = await mkdtemp(join(tmpdir(), 'cshell-floating-'));
const server = await fixture();
const env = { ...process.env, CSHELL_TEST_DATA: data };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.'], env });
try {
  const page = await app.firstWindow();
  await page.getByRole('heading', { name: '尚未连接' }).waitFor();
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as any;
  });
  await page.getByRole('button', { name: '新建连接', exact: true }).first().click();
  const form = page.locator('.connection-editor:visible');
  await form.getByLabel('主机地址').fill('127.0.0.1');
  await form.getByLabel('端口').fill(String(server.port));
  await form.getByLabel('用户名').fill('tester');
  await form.locator('.connection-secret input').fill(server.password);
  await form.getByRole('button', { name: '连接', exact: true }).click();
  await page.locator('.session-tab').waitFor();
  const id = (await page.locator('.session-tab').getAttribute('data-session'))!;
  await page.evaluate((id) => window.cshell.input(id, 'history-before-float\r\n'), id);
  await page.waitForTimeout(200);
  const firstWindow = app.waitForEvent('window');
  await page.getByRole('button', { name: '在独立小窗打开' }).click();
  const first = await firstWindow;
  first.on('pageerror', (e) => console.log('CHILD', e.message));
  await first.waitForTimeout(1000);
  assert.match(await first.locator('.floating-screen').innerText(), /history-before-float/);
  await first.getByRole('button', { name: '仅观察', exact: true }).waitFor();
  await first.waitForFunction(
    () => !(document.querySelector('.floating-bar button') as HTMLButtonElement).disabled,
  );
  await first.locator('.floating-screen .xterm-screen').waitFor();
  assert.equal(
    await first.evaluate(() =>
      window.cshell.config().then(
        () => false,
        () => true,
      ),
    ),
    true,
  );
  const native = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .filter((w) => w.webContents.getURL().includes('?floating='))
      .map((w) => ({ size: w.getSize(), min: w.getMinimumSize() })),
  );
  assert.ok(Math.abs(native[0].size[0] - 560) < 5 && Math.abs(native[0].size[1] - 360) < 5);
  assert.deepEqual(native[0].min, [320, 200]);
  await first.locator('.xterm-helper-textarea').focus();
  await first.keyboard.type('from-floating');
  await first.keyboard.press('Enter');
  await first.waitForTimeout(100);
  assert.ok(server.shellInputs.join('').includes('from-floating'));
  const queryStart = server.shellInputs.length;
  await page.evaluate((id) => window.cshell.input(id, '\x1b[6n'), id);
  await first.waitForTimeout(200);
  assert.equal(
    (
      server.shellInputs
        .slice(queryStart)
        .join('')
        .match(/\x1b\[\d+;\d+R/g) || []
    ).length,
    1,
  );
  await first.getByRole('button', { name: '仅观察', exact: true }).click();
  assert.equal(
    await first.evaluate(() =>
      window.cshell.floatingInput('blocked').then(
        () => false,
        () => true,
      ),
    ),
    true,
  );
  await first.getByRole('button', { name: '窗口置顶', exact: true }).click();
  assert.equal(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().includes('?floating='))!
        .isAlwaysOnTop(),
    ),
    true,
  );
  await page.bringToFront();
  const secondWindow = app.waitForEvent('window');
  await page.getByRole('button', { name: '在独立小窗打开' }).click();
  const second = await secondWindow;
  await second.waitForFunction(
    () => !(document.querySelector('.floating-bar button') as HTMLButtonElement)?.disabled,
  );
  assert.equal(await page.locator('.session-tab').count(), 1);
  await mkdir('test-results', { recursive: true });
  await first.screenshot({ path: 'test-results/floating-terminal.png' });
  await Promise.all([
    second.waitForEvent('close'),
    second.getByRole('button', { name: '返回工作台', exact: true }).click(),
  ]);
  await first.getByRole('button', { name: '关闭小窗', exact: true }).click();
  await page.evaluate((id) => window.cshell.input(id, 'still-connected\r\n'), id);
  await page.waitForTimeout(100);
  assert.ok(server.shellInputs.join('').includes('still-connected'));
  assert.equal(await page.locator('.session-tab .dot.off').count(), 0);
  console.log(
    'PASS: shared live session, small native windows, read-only enforcement, per-window pin, restricted IPC, restore and close preserve connection',
  );
} finally {
  await app.close();
  await server.close();
  await rm(data, { recursive: true, force: true });
}
