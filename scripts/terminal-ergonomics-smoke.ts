import { _electron as electron } from 'playwright';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const directory = await mkdtemp(join(tmpdir(), 'cshell-terminal-keys-'));
const env = { ...process.env, CSHELL_TEST_DATA: directory }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.'], env });
const clipboard = await app.evaluate(({ clipboard }) => clipboard.readText());
try {
  const page = await app.firstWindow(); page.setDefaultTimeout(15000);
  await page.getByLabel('新建本机终端', { exact: true }).click();
  await page.getByRole('menuitem', { name: 'CMD', exact: true }).click();
  const pane = page.locator('.terminal-pane.active');
  await pane.locator('.xterm-helper-textarea').waitFor({ state: 'attached' });
  await page.evaluate(() => { (window as any).output = ''; window.cshell.events(event => { if (event.type === 'data') (window as any).output += event.data; }); });
  await app.evaluate(({ clipboard }) => clipboard.writeText('echo CLIPBOARD_KEY_OK'));
  await pane.locator('.xterm-helper-textarea').focus();
  await page.keyboard.press('Control+v'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => (window as any).output.includes('CLIPBOARD_KEY_OK'));
  await page.keyboard.press('Control+c');
  await pane.getByRole('button', { name: '快捷键', exact: true }).click();
  await pane.getByRole('button', { name: '中断 · Ctrl+C', exact: true }).click();
  await pane.getByLabel('原生按键', { exact: true }).check();
  assert.equal(await pane.getByLabel('原生按键', { exact: true }).isChecked(), true);
  await pane.getByLabel('原生按键', { exact: true }).uncheck();
  await app.evaluate(({ clipboard }) => clipboard.writeText('echo root@host:~# https://example.com/test'));
  await pane.locator('.xterm-helper-textarea').focus();
  await page.keyboard.press('Control+v'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => (window as any).output.includes('root@host:~# https://example.com/test'));
  await pane.locator('.xterm-decoration').first().waitFor({ state: 'attached' });
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/terminal-ergonomics.png' });
  console.log('PASS: real terminal clipboard paste, native control toolbar and visible decorations');
} finally {
  await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), clipboard);
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await app.close().catch(() => {});
  await rm(directory, { recursive: true, force: true });
}
