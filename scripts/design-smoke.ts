import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import type { ElectronApplication, Page } from 'playwright';

export async function designSmoke(app: ElectronApplication, page: Page) {
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  await page.getByRole('button', { name: '切换为深色', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.getByRole('button', { name: '新建连接', exact: true }).first().click();
  if (await page.getByRole('button', { name: '添加连接记录', exact: true }).isVisible())
    await page.getByRole('button', { name: '添加连接记录', exact: true }).click();
  const editor = page.locator('.connection-editor:visible');
  await editor.getByLabel('保存到服务器列表').uncheck();
  const name = editor.getByLabel('主机地址', { exact: true });
  await page.screenshot({ path: 'test-results/connection-redesign-dark.png' });
  await editor.getByRole('button', { name: '连接', exact: true }).click();
  assert.equal(await name.getAttribute('aria-invalid'), 'true');
  assert.equal(await name.evaluate((el) => el === document.activeElement), true);
  assert.equal((await page.evaluate(() => window.cshell.config())).profiles.length, 0);
  await name.fill('127.0.0.1');
  await editor.getByLabel('端口').fill('0');
  await editor.getByRole('button', { name: '连接', exact: true }).click();
  assert.equal(await editor.getByLabel('端口').getAttribute('aria-invalid'), 'true');
  await editor.getByLabel('端口').fill('22');
  await editor.locator('.connection-secret input').fill('draft-secret');
  await page.evaluate(() => window.cshell.copyText('ssh deploy@example.test -p 2222'));
  await name.fill('');
  await name.focus();
  await page.keyboard.press('Control+v');
  await editor.getByLabel('端口').focus();
  assert.equal(await name.inputValue(), 'ssh deploy@example.test -p 2222');
  assert.equal(await editor.getByLabel('用户名').inputValue(), 'root');
  await editor.getByRole('button', { name: '连接', exact: true }).click();
  assert.equal(await name.getAttribute('aria-invalid'), 'true');
  await editor.getByRole('button', { name: '粘贴连接信息', exact: true }).click();
  await editor.getByRole('button', { name: '提取并填写', exact: true }).click();
  await editor.getByText('已填入连接信息，仍可手动修改。', { exact: true }).waitFor();
  assert.equal(await name.inputValue(), 'example.test');
  assert.equal(await editor.getByLabel('用户名').inputValue(), 'deploy');
  assert.equal(await editor.getByLabel('端口').inputValue(), '2222');
  assert.equal(await editor.locator('.connection-secret input').inputValue(), 'draft-secret');
  await page.evaluate(() => window.cshell.copyText('ssh host -J jump'));
  await editor.getByRole('button', { name: '粘贴连接信息', exact: true }).click();
  await editor.getByRole('button', { name: '提取并填写', exact: true }).click();
  await editor.getByRole('alert').filter({ hasText: '未找到可识别的 SSH 信息' }).waitFor();
  assert.equal(await name.inputValue(), 'example.test');
  await name.fill('127.0.0.1');
  await editor.getByLabel('用户名').fill('root');
  await editor.getByLabel('端口').fill('22');
  await editor.getByRole('button', { name: '显示密码', exact: true }).click();
  assert.equal(await editor.locator('.connection-secret input').getAttribute('type'), 'text');
  await editor.getByRole('radio', { name: '私钥', exact: true }).check();
  await editor.getByRole('button', { name: '连接', exact: true }).click();
  await editor.getByRole('alert').filter({ hasText: '请选择私钥' }).waitFor();
  assert.equal(await page.getByRole('dialog').count(), 0);
  await editor.getByRole('radio', { name: '密码', exact: true }).check();
  assert.equal(await editor.locator('.connection-secret input').inputValue(), 'draft-secret');
  assert.equal(await editor.locator('.connection-secret input').getAttribute('type'), 'password');
  await name.focus();
  const before = await editor.boundingBox();
  await page.keyboard.press('Control+Shift+p');
  const search = page.getByRole('combobox', { name: '搜索命令或服务器…' });
  await search.waitFor();
  await page.locator('.palette-trigger').click();
  await page.locator('.command-picker').waitFor({ state: 'hidden' });
  await page.locator('.palette-trigger').click();
  await search.waitFor();
  await page.keyboard.press('Escape');
  assert.equal(
    await page.locator('.palette-trigger').evaluate((el) => el === document.activeElement),
    true,
  );
  await name.focus();
  await page.keyboard.press('Control+Shift+p');
  await search.waitFor();
  assert.deepEqual(await editor.boundingBox(), before);
  assert.equal(await page.getByRole('option', { name: '还原默认布局', exact: true }).count(), 0);
  await search.fill('not-a-command');
  await page.getByText('没有匹配的结果', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await name.evaluate((el) => el === document.activeElement), true);
  assert.equal(await name.inputValue(), '127.0.0.1');
  await page.keyboard.press('Control+Shift+p');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter'); // Preferences, selected through the keyboard.
  await page.locator('.preferences-page:visible').waitFor();
  await page.locator('.preferences-page').getByLabel('外观').selectOption('light');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  // The persisted theme is still dark here; the quick toggle must also update a preview.
  await page.getByRole('button', { name: '切换为深色', exact: true }).click();
  await page.waitForFunction(
    async () =>
      document.documentElement.dataset.theme === 'dark' &&
      document.querySelector<HTMLSelectElement>('#workspace-preferences-form select')?.value ===
        'dark' &&
      (await window.cshell.config()).preferences.theme === 'dark',
  );
  await page.getByRole('button', { name: '切换为浅色', exact: true }).click();
  await page.waitForFunction(
    async () =>
      document.documentElement.dataset.theme === 'light' &&
      document.querySelector<HTMLSelectElement>('#workspace-preferences-form select')?.value ===
        'light' &&
      (await window.cshell.config()).preferences.theme === 'light',
  );
  for (let cycle = 0; cycle < 4; cycle++) {
    for (const [label, theme] of [
      ['切换为深色', 'dark'],
      ['切换为浅色', 'light'],
    ] as const) {
      await page.getByRole('button', { name: label, exact: true }).click();
      await page.waitForFunction(async (theme) => {
        const saved = (await window.cshell.config()).preferences.theme;
        return (
          saved === theme &&
          document.documentElement.dataset.theme === theme &&
          document.querySelector<HTMLSelectElement>('#workspace-preferences-form select')?.value ===
            theme
        );
      }, theme);
      assert.equal(await page.locator('.preferences-page').getByLabel('外观').inputValue(), theme);
    }
  }
  assert.equal(await page.locator('.preferences-page').getByLabel('外观').inputValue(), 'light');
  await page
    .locator('.preferences-page')
    .getByRole('button', { name: '保存', exact: true })
    .click();
  await page.locator('.tabs').getByRole('button', { name: '新建连接', exact: true }).click();
  assert.equal(await name.inputValue(), '127.0.0.1');
  await editor.locator('.connection-secret input').fill('');
  await name.fill('');
  await editor.getByLabel('主机地址').fill('');
  await page.screenshot({ path: 'test-results/connection-redesign-light.png' });
  const native = await app.evaluate(async ({ BrowserWindow, desktopCapturer }) => {
    const ownId = BrowserWindow.getAllWindows()[0].getMediaSourceId();
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 1920, height: 1200 },
    });
    const own = sources.find((source) => source.id === ownId);
    if (!own || own.thumbnail.isEmpty()) throw new Error('Native CShell capture unavailable');
    return own.thumbnail.toPNG().toString('base64');
  });
  await writeFile('test-results/native-window-0.1.8.png', Buffer.from(native, 'base64'));
  await page.keyboard.press('Control+Shift+p');
  await page.screenshot({ path: 'test-results/command-picker-light.png' });
  // Click outside the picker at all responsive window sizes (the host input may lie under it).
  await editor.getByLabel('用户名').click();
  await page.locator('.command-picker').waitFor({ state: 'hidden' });
  await editor.getByRole('radio', { name: '私钥', exact: true }).check();
  await page.screenshot({ path: 'test-results/connection-key-light.png' });
  // Resize the real native window, including title bar and panel constraints.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 640));
  await page.waitForFunction(() => innerWidth <= 900);
  await editor.getByRole('button', { name: '连接', exact: true }).scrollIntoViewIfNeeded();
  const overflow = await editor.evaluate((el) => el.scrollWidth > el.clientWidth);
  assert.equal(overflow, false);
  await page.screenshot({ path: 'test-results/connection-compact.png' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 920));
  await page.getByRole('button', { name: '偏好设置', exact: true }).click();
  await page.locator('.preferences-page:visible').getByLabel('外观').selectOption('dark');
  await page
    .locator('.preferences-page:visible')
    .getByRole('button', { name: '保存', exact: true })
    .click();
  await page.locator('.tabs').getByRole('button', { name: '新建连接', exact: true }).click();
  await page.getByRole('button', { name: '关闭连接编辑 · 放弃未保存修改', exact: true }).click();
  console.log(
    'PASS: inline validation, auth controls, keyboard command search, no layout shift, draft/focus preservation, native compact window',
  );
}
