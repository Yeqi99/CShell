import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

const data = await mkdtemp(join(tmpdir(), 'cshell-pin-'));
const env = { ...process.env, CSHELL_TEST_DATA: data };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.'], env, timeout: 15000 });
try {
  const page = await app.firstWindow();
  await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
  const pinned = () =>
    app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isAlwaysOnTop());
  const waitPinned = async (expected: boolean) => {
    for (let i = 0; i < 50; i++) {
      if ((await pinned()) === expected) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(await pinned(), expected);
  };
  assert.equal(await pinned(), false);
  await page.getByRole('button', { name: '极简模式 / Minimal mode' }).click();
  const pin = page.getByRole('button', { name: '窗口置顶', exact: true });
  await pin.focus();
  await page.keyboard.press('Space');
  await waitPinned(true);
  const bounds = await app.evaluate(({ BrowserWindow }) => ({
    size: BrowserWindow.getAllWindows()[0].getSize(),
    minimum: BrowserWindow.getAllWindows()[0].getMinimumSize(),
  }));
  assert.deepEqual(bounds.minimum, [320, 200]);
  assert.ok(bounds.size[0] <= 565 && bounds.size[1] <= 365);
  assert.equal(
    await page.getByRole('button', { name: '取消置顶' }).getAttribute('aria-pressed'),
    'true',
  );
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/minimal-pinned.png' });
  await page.getByRole('button', { name: '取消置顶' }).click();
  await waitPinned(false);
  await pin.click();
  await waitPinned(true);
  await page.getByRole('button', { name: '还原工作台 / Restore workbench' }).click();
  await waitPinned(false);
  await page.getByRole('button', { name: '极简模式 / Minimal mode' }).click();
  assert.equal(await pin.getAttribute('aria-pressed'), 'false');
  await pin.click();
  await waitPinned(true);
  await page.evaluate(() => window.dispatchEvent(new Event('cshell:open-ai')));
  await waitPinned(false);
  assert.equal(await page.locator('.minimal-pin').count(), 0);
  const rejected = await page.evaluate(() =>
    window.cshell.setAlwaysOnTop('yes' as unknown as boolean).then(
      () => false,
      () => true,
    ),
  );
  assert.equal(rejected, true);
  assert.equal(await pinned(), false);
  console.log(
    'PASS: native always-on-top, keyboard toggle, unpin, restore, automatic minimal exit and IPC validation',
  );
} finally {
  await app.close();
  await rm(data, { recursive: true, force: true });
}
