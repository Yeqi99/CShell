import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { mcpDesktopSmoke } from './mcp-desktop-smoke';
import { workspaceSmoke } from './workspace-smoke';
import { designSmoke } from './design-smoke';
import { workbenchSmoke } from './workbench-smoke';
import { appearanceSmoke } from './appearance-smoke';
import { fixture } from '../tests/fixture';
import { groupsSmoke } from './groups-smoke';

async function main() {
  const data = await mkdtemp(join(tmpdir(), 'cshell-desktop-'));
  const server = await fixture();
  await mkdir('test-results', { recursive: true });
  const env = { ...process.env, CSHELL_TEST_DATA: data };
  delete env.ELECTRON_RUN_AS_NODE;
  let app = await electron.launch({
    args: process.env.CSHELL_EXECUTABLE ? [] : ['.'],
    ...(process.env.CSHELL_EXECUTABLE ? { executablePath: process.env.CSHELL_EXECUTABLE } : {}),
    env,
    timeout: 30000,
  });
  const errors: string[] = [];
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    page.on('pageerror', (error) => errors.push(error.message));
    await page.getByRole('heading', { name: '尚未连接' }).waitFor();
    await page.waitForFunction(
      () => document.querySelector<HTMLImageElement>('.brand-mark')?.naturalWidth === 256,
    );
    await page.screenshot({ path: 'test-results/brand-tabs-light.png' });
    const chrome = await page.evaluate(() => ({
      overlayVisible: (navigator as Navigator & { windowControlsOverlay?: { visible: boolean } })
        .windowControlsOverlay?.visible,
      top: document.querySelector('.topbar')!.getBoundingClientRect().top,
      drag: getComputedStyle(document.querySelector('.topbar')!).getPropertyValue(
        '-webkit-app-region',
      ),
      buttonDrag: getComputedStyle(document.querySelector('.topbar button')!).getPropertyValue(
        '-webkit-app-region',
      ),
    }));
    assert.equal(chrome.overlayVisible, true);
    assert.equal(chrome.top, 0);
    assert.equal(chrome.drag, 'drag');
    assert.equal(chrome.buttonDrag, 'no-drag');
    assert.equal(await page.locator('.monitor-panel').count(), 0);
    assert.equal(
      await page
        .locator('.topbar')
        .innerText()
        .then((text) => /CanpShell|⇧|⌘/.test(text)),
      false,
    );
    await page.getByRole('button', { name: /命令面板/ }).click();
    await page.locator('.inline-finder input').fill('新建');
    assert.equal(await page.getByRole('dialog').count(), 0);
    await page.keyboard.press('Escape');
    await page.screenshot({ path: 'test-results/welcome-dark.png' });
    await workspaceSmoke(page);
    await designSmoke(app, page);
    await workbenchSmoke(app, page, server);
    assert.equal(await page.evaluate(() => typeof (window as any).require), 'undefined');
    await page.getByRole('button', { name: '新建连接', exact: true }).first().click();
    const dialog = page.locator('.editor-page:visible');
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.equal(await page.locator('.monitor-panel').count(), 0);
    await dialog.getByLabel('保存到服务器列表').check();
    await dialog.getByLabel('名称', { exact: true }).fill('Local integration');
    await page.getByRole('button', { name: '偏好设置', exact: true }).click();
    assert.equal(await page.getByRole('dialog').count(), 0);
    await page.locator('.tabs').getByRole('button', { name: '新建连接', exact: true }).click();
    assert.equal(
      await dialog.getByLabel('名称', { exact: true }).inputValue(),
      'Local integration',
    );
    await page.screenshot({ path: 'test-results/connection-editor.png' });
    await dialog.getByLabel('主机地址').fill('127.0.0.1');
    await dialog.getByLabel('端口').fill(String(server.port));
    await dialog.getByLabel('用户名').fill('tester');
    await dialog.getByRole('button', { name: '仅保存', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await page.locator('.tabs').getByRole('button', { name: '偏好设置', exact: true }).click();
    await page
      .locator('.editor-page:visible')
      .getByRole('button', { name: '取消', exact: true })
      .click();
    const config = await page.evaluate(() => window.cshell.config());
    assert.equal(config.profiles.length, 1);
    await page.getByRole('button', { name: '切换为浅色', exact: true }).click();
    await groupsSmoke(page);
    await page.getByRole('button', { name: '切换为深色', exact: true }).click();
    await appearanceSmoke(app, page, data);
    await mcpDesktopSmoke(app, page);
    // Drive native confirmation deterministically while using the production IPC and SSH stack.
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = (async () => ({
        response: 1,
        checkboxChecked: false,
      })) as typeof dialog.showMessageBox;
    });
    await page.getByRole('button', { name: /Local integration 127.0.0.1/ }).dblclick();
    await page
      .locator('.connection-editor:visible .connection-secret input')
      .fill('wrong-password');
    await page
      .locator('.connection-editor:visible')
      .getByRole('button', { name: '保存并连接', exact: true })
      .click();
    await page.locator('.connection-editor:visible .connection-error').waitFor();
    assert.equal(await page.locator('.toast').count(), 0);
    assert.equal(await page.locator('.monitor-panel').count(), 0);
    assert.equal(
      await page
        .locator('.connection-editor:visible')
        .getByLabel('名称', { exact: true })
        .inputValue(),
      'Local integration',
    );
    await page
      .locator('.editor-page:visible')
      .locator('.connection-secret input')
      .fill(server.password);
    await page.locator('.editor-page:visible').getByLabel('使用系统加密保存凭据').check();
    await page
      .locator('.editor-page:visible')
      .getByRole('button', { name: '保存并连接', exact: true })
      .click();
    await page.locator('.editor-page:visible').waitFor({ state: 'hidden', timeout: 15000 });
    await page.getByText('hello.txt', { exact: true }).waitFor();
    assert.equal(await page.locator('.files-title').innerText(), '文件');
    assert.equal(await page.getByText('代码片段', { exact: true }).count(), 0);
    await page.locator('.xterm-screen').click();
    await page.keyboard.type('desktop-echo');
    await page.waitForFunction(() =>
      document.querySelector('.xterm-screen')?.textContent?.includes('desktop-echo'),
    );
    const connectedId = await page.locator('.session-tab').getAttribute('data-session');
    await page.getByRole('button', { name: '连接操作 · Local integration', exact: true }).click();
    await page.getByRole('menuitem', { name: '移至分组', exact: true }).click();
    await page.getByRole('menuitemradio', { name: 'Empty group', exact: true }).click();
    await page.waitForFunction(
      async () => (await window.cshell.config()).profiles[0].group === 'Empty group',
    );
    assert.equal(await page.locator('.session-tab').getAttribute('data-session'), connectedId);
    await page.locator('.xterm-screen').click();
    await page.keyboard.type('after-group-move');
    await page.waitForFunction(() =>
      document.querySelector('.xterm-screen')?.textContent?.includes('after-group-move'),
    );
    assert.ok(
      (await page.evaluate(() => window.cshell.config())).savedCredentials.includes(
        config.profiles[0].id,
      ),
    );
    await page.getByRole('button', { name: '新建连接', exact: true }).first().click();
    await page.locator('.editor-page:visible').getByLabel('保存到服务器列表').check();
    await page
      .locator('.editor-page:visible')
      .getByLabel('名称', { exact: true })
      .fill('Draft preserved');
    assert.equal(await page.locator('.monitor-panel').count(), 0);
    await page
      .locator('.tabs')
      .getByRole('button', { name: 'Local integration', exact: true })
      .click();
    await page.waitForFunction(() =>
      document.querySelector('.xterm-screen')?.textContent?.includes('desktop-echo'),
    );
    await page.locator('.tabs').getByRole('button', { name: '新建连接', exact: true }).click();
    assert.equal(
      await page.locator('.editor-page:visible').getByLabel('名称', { exact: true }).inputValue(),
      'Draft preserved',
    );
    await page.getByRole('button', { name: '关闭连接编辑 · 放弃未保存修改', exact: true }).click();
    await page.getByText('hello.txt', { exact: true }).waitFor();
    await page.screenshot({ path: 'test-results/workspace-dark.png' });
    await page
      .locator('.tools-panel')
      .getByRole('button', { name: '新建目录', exact: true })
      .click();
    assert.equal(await page.getByRole('dialog').count(), 0);
    await page.locator('.inline-file-editor input').fill('inline-folder');
    await page
      .locator('.inline-file-editor')
      .getByRole('button', { name: '确认', exact: true })
      .click();
    await page.getByText('inline-folder', { exact: true }).waitFor();
    const persisted = await readFile(join(data, 'config.json'), 'utf8');
    assert.ok(!persisted.includes(server.password));
    assert.ok(JSON.parse(persisted).secrets[config.profiles[0].id]);
    await page.evaluate(() => window.cshell.copyText('clipboard 中文'));
    assert.equal(await page.evaluate(() => window.cshell.pasteText()), 'clipboard 中文');
    const localDirectory = join(data, 'local');
    await mkdir(localDirectory);
    await writeFile(join(localDirectory, 'upload.txt'), 'uploaded from desktop');
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [path],
      })) as typeof dialog.showOpenDialog;
    }, localDirectory);
    await page.getByRole('button', { name: '本地文件', exact: true }).click();
    await page.getByRole('button', { name: '选择目录', exact: true }).last().click();
    await page.locator('.local-dock').getByText('upload.txt', { exact: true }).waitFor();
    // Internal file clipboard, driven with real keyboard events across both file panels.
    await page.locator('.local-dock .file-row').filter({ hasText: 'upload.txt' }).click();
    await page.keyboard.press('Control+c');
    await page.locator('.tools-panel .file-list').focus();
    await page.keyboard.press('Control+v');
    await page.locator('.tools-panel').getByText('upload.txt', { exact: true }).waitFor();
    assert.equal(await readFile(join(server.root, 'upload.txt'), 'utf8'), 'uploaded from desktop');
    await page.locator('.tools-panel .file-row').filter({ hasText: 'hello.txt' }).click();
    await page.keyboard.press('Control+c');
    await page.locator('.local-dock .file-list').focus();
    await page.keyboard.press('Control+v');
    await page.locator('.local-dock').getByText('hello.txt', { exact: true }).waitFor();
    assert.equal(await readFile(join(localDirectory, 'hello.txt'), 'utf8'), '你好，CShell 🌏\n');
    await page.screenshot({ path: 'test-results/file-workspace.png' });
    await page.locator('.local-dock').getByRole('button', { name: '关闭', exact: true }).click();
    await page.getByText('40%', { exact: true }).waitFor();
    await page.getByText('4 逻辑核心', { exact: true }).waitFor();
    await page.getByText('30 GiB / 100 GiB', { exact: true }).waitFor();
    assert.equal(
      await page.locator('.metric-disk [role="meter"]').getAttribute('aria-valuenow'),
      '30',
    );
    await page.getByRole('button', { name: '偏好设置', exact: true }).click();
    assert.equal(await page.locator('.monitor-panel').count(), 0);
    assert.equal(await page.getByRole('dialog').count(), 0);
    await page.locator('.editor-page:visible').getByLabel('外观').selectOption('light');
    await page.locator('.editor-page:visible').getByLabel('语言').selectOption('en-US');
    await page
      .locator('.editor-page:visible')
      .getByRole('button', { name: '保存', exact: true })
      .click();
    await page.getByLabel('Monitor', { exact: true }).waitFor();
    await page.screenshot({ path: 'test-results/workspace-light-en.png' });
    await page.setViewportSize({ width: 900, height: 640 });
    await page.screenshot({ path: 'test-results/compact.png' });
    await page.locator('.tab .icon').first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
    await page.locator('.monitor-panel').waitFor({ state: 'hidden' });
    assert.deepEqual(errors, []);
    await app.close();
    app = await electron.launch({
      args: process.env.CSHELL_EXECUTABLE ? [] : ['.'],
      ...(process.env.CSHELL_EXECUTABLE ? { executablePath: process.env.CSHELL_EXECUTABLE } : {}),
      env,
      timeout: 30000,
    });
    const restarted = await app.firstWindow();
    await restarted.waitForFunction(async () =>
      (await window.cshell.config()).groups.includes('Empty group'),
    );
    await restarted.locator('.workbench-background').waitFor({ state: 'attached' });
    await restarted.waitForFunction(() =>
      [...document.fonts].some(
        (font) => font.family.startsWith('CShell-') && font.status === 'loaded',
      ),
    );
    assert.equal(
      (await restarted.evaluate(() => window.cshell.config())).preferences.backgroundOpacity,
      0.3,
    );
    console.log(
      'PASS: imported fonts and background reload after a full app restart without original files',
    );
    console.log(
      'PASS: desktop rendering, profile persistence, password SSH, terminal input, SFTP, DPAPI, clipboard, bidirectional file clipboard transfers, monitoring, i18n/theme, compact layout',
    );
  } finally {
    await app.close();
    await server.close();
    await rm(data, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
