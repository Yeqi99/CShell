import { extensionsSmoke } from './extensions-smoke';
import { dockerSmoke } from './docker-smoke';
import { editorAssistantSmoke } from './editor-assistant-smoke';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ElectronApplication, Page } from 'playwright';

/** Real SSH sessions, isolated test account; captures the uncustomized product defaults. */
export async function workbenchSmoke(
  app: ElectronApplication,
  page: Page,
  server: {
    port: number;
    password: string;
    root: string;
    shellInputs: string[];
    extensions: { inputs: string[] };
  },
) {
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = (async () => ({
      response: 1,
      checkboxChecked: false,
    })) as typeof dialog.showMessageBox;
  });
  await mkdir(join(server.root, 'projects'));
  const connect = async () => {
    await page.getByRole('button', { name: '新建连接', exact: true }).first().click();
    if (await page.getByRole('button', { name: 'SSH 终端', exact: true }).isVisible())
      await page.getByRole('button', { name: 'SSH 终端', exact: true }).click();
    const form = page.locator('.connection-editor:visible');
    await form.getByLabel('保存到服务器列表').uncheck();
    assert.equal(await form.getByLabel('名称', { exact: true }).count(), 0);
    await page.evaluate(
      (text) => window.cshell.copyText(text),
      `ssh tester@127.0.0.1 -p ${server.port}`,
    );
    await form.getByRole('button', { name: '粘贴连接信息', exact: true }).click();
    await form.getByRole('button', { name: '提取并填写', exact: true }).click();
    await form.getByText('已填入连接信息，仍可手动修改。', { exact: true }).waitFor();
    assert.equal(await form.getByLabel('主机地址').inputValue(), '127.0.0.1');
    assert.equal(await form.getByLabel('用户名').inputValue(), 'tester');
    assert.equal(await form.getByLabel('端口').inputValue(), String(server.port));
    await form.locator('.connection-secret input').fill(server.password);
    await form.getByRole('button', { name: '连接', exact: true }).click();
    await form.waitFor({ state: 'hidden' });
    await page.locator('.tools-panel:visible').getByText('hello.txt', { exact: true }).waitFor();
  };
  await connect();
  const firstId = await page.locator('.session-tab').getAttribute('data-session');
  const config = await page.evaluate(() => window.cshell.config());
  assert.equal(config.profiles.length, 0);
  assert.equal(config.savedCredentials.length, 0);
  await page.locator('.xterm-screen:visible').click();
  await page.keyboard.type('first-session');
  await page.waitForFunction(() =>
    document.querySelector('.xterm-screen')?.textContent?.includes('first-session'),
  );
  const screen = page.locator('.xterm-screen:visible');
  const oldHeight = await screen.evaluate(
    (el) => el.querySelector('.xterm-rows > div')?.getBoundingClientRect().height,
  );
  await page.keyboard.press('Control+Shift+Equal');
  await page.waitForFunction(
    (height) =>
      (document.querySelector('.xterm-rows > div')?.getBoundingClientRect().height || 0) >
      (height || 0),
    oldHeight,
  );
  await page.keyboard.press('Control+Shift+Digit0');
  await page.waitForFunction(
    (height) =>
      document.querySelector('.xterm-rows > div')?.getBoundingClientRect().height === height,
    oldHeight,
  );
  await page.getByRole('button', { name: '切换为浅色', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  await page.locator('.metric-cpu strong').getByText('10%', { exact: true }).waitFor();
  assert.equal(
    await screen.evaluate((el) => getComputedStyle(el.closest('.main-area')!).backgroundColor),
    'rgb(255, 255, 255)',
  );
  const upload = page
    .locator('.tools-panel:visible .file-actions')
    .getByRole('button', { name: '上传', exact: true });
  assert.equal((await upload.innerText()).trim(), '');
  await upload.focus();
  await page.getByRole('tooltip').filter({ hasText: '上传' }).waitFor();
  await page.keyboard.press('Escape');
  await page.mouse.move(10, 10);
  await page.screenshot({ path: 'test-results/workbench-default-light.png' });
  const native = await app.evaluate(async ({ BrowserWindow, desktopCapturer }) => {
    const ownId = BrowserWindow.getAllWindows()[0].getMediaSourceId();
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 1920, height: 1200 },
    });
    const own = sources.find((source) => source.id === ownId);
    if (!own || own.thumbnail.isEmpty()) throw new Error('Native capture unavailable');
    return own.thumbnail.toPNG().toString('base64');
  });
  await writeFile('test-results/workbench-native-light.png', Buffer.from(native, 'base64'));
  await editorAssistantSmoke(app, page, firstId!, server.shellInputs);
  await dockerSmoke(app, page, firstId!, server.shellInputs);
  await extensionsSmoke(app, page, firstId!, server.root, server.extensions.inputs);
  await page.locator('.tools-panel:visible').getByText('projects', { exact: true }).dblclick();
  await page.waitForFunction(
    () =>
      document.querySelector<HTMLInputElement>(
        '.session-tools:not([hidden]) input[aria-label="路径"]',
      )?.value === '/projects',
  );
  await page.keyboard.press('Control+Shift+e');
  await page.locator('.dock-side[data-panel="files"]').waitFor({ state: 'hidden' });
  await page.keyboard.press('Control+Shift+e');
  assert.equal(
    await page.locator('.tools-panel:visible').getByLabel('路径', { exact: true }).inputValue(),
    '/projects',
  );
  await connect();
  const secondId = await page.locator('.session-tab.active').getAttribute('data-session');
  assert.notEqual(firstId, secondId);
  assert.equal(
    await page.locator('.tools-panel:visible').getByLabel('路径', { exact: true }).inputValue(),
    '/',
  );
  // The edge of the tab is actionable, including space outside the text.
  await page.locator(`[data-session="${firstId}"]`).click({ position: { x: 1, y: 18 } });
  assert.equal(
    await page.locator('.tools-panel:visible').getByLabel('路径', { exact: true }).inputValue(),
    '/projects',
  );
  assert.ok(
    await page
      .locator('.xterm-screen:visible')
      .textContent()
      .then((s) => s?.includes('first-session')),
  );
  await page.locator(`[data-session="${firstId}"] > button`).first().focus();
  await page.keyboard.press('F2');
  await page.getByLabel('重命名会话标签').fill('build');
  await page.keyboard.press('Enter');
  await page.locator('.tabs').getByRole('button', { name: 'build', exact: true }).waitFor();
  await page
    .locator(`[data-session="${secondId}"]`)
    .dragTo(page.locator(`[data-session="${firstId}"]`));
  assert.equal(await page.locator('.session-tab').first().getAttribute('data-session'), secondId);
  await page.keyboard.press('Control+Tab');
  assert.equal(await page.locator('.session-tab.active').getAttribute('data-session'), secondId);
  await page.getByRole('button', { name: '切换为深色', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.screenshot({ path: 'test-results/workbench-default-dark.png' });
  await page.locator('.terminal-pane.active .xterm-screen').click({ button: 'right' });
  await page
    .locator('.terminal-pane.active .terminal-assistant-choices')
    .getByRole('button', { name: 'Vim', exact: true })
    .click();
  await page.locator('.editor-actions:visible').waitFor();
  // A remote disconnect preserves terminal text but immediately retires tools.
  await page.evaluate((id) => window.cshell.disconnect(id!), secondId);
  await page.locator('.disconnected-session-bar').waitFor();
  assert.equal(await page.locator('.monitor-panel').count(), 0);
  assert.equal(await page.locator('.editor-actions:visible').count(), 0);
  await page.locator('.session-tab.active .icon').click();
  await page.locator(`[data-session="${secondId}"]`).waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '关闭 build', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click();
  await page.locator('.session-tab').waitFor({ state: 'hidden' });
  await page.locator('.monitor-panel').waitFor({ state: 'hidden' });
  assert.equal((await page.evaluate(() => window.cshell.config())).profiles.length, 0);
  console.log(
    'PASS: temporary SSH command paste, no stored profile/credentials, clean default themes, terminal zoom, icon tooltips, per-session paths, full-tab hit target, rename/reorder, keyboard switching and disconnect',
  );
}
