import assert from 'node:assert/strict';
import { copyFile, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ElectronApplication, Page } from 'playwright';

export async function appearanceSmoke(app: ElectronApplication, page: Page, data: string) {
  const settingsButton = page.locator('.topbar button').last();
  await page.mouse.move(10, 10);
  await settingsButton.hover();
  await page.getByRole('tooltip').filter({ hasText: '偏好设置' }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('tooltip').waitFor({ state: 'hidden' });
  await settingsButton.focus();
  await page.getByRole('tooltip').waitFor();
  assert.equal(await settingsButton.evaluate((el) => getComputedStyle(el).outlineStyle), 'solid');
  await settingsButton.click();
  const before = await page.evaluate(() => window.cshell.config());
  const fonts = await page.evaluate(() => window.cshell.systemFonts());
  assert.ok(fonts.includes('Consolas'));
  await page.getByText(`本机已安装字体 · ${fonts.length}`, { exact: true }).waitFor();
  await page
    .getByRole('combobox', { name: '界面字体', exact: true })
    .selectOption({ label: 'Consolas' });
  await page.waitForFunction(() => document.body.style.fontFamily.includes('Consolas'));
  await page
    .locator('.editor-page:visible')
    .getByRole('button', { name: '取消', exact: true })
    .click();
  await page.waitForFunction((font) => {
    const sample = document.createElement('span');
    sample.style.fontFamily = font;
    return document.body.style.fontFamily === sample.style.fontFamily;
  }, before.preferences.uiFont);
  await settingsButton.click();
  const sourceFont = join(data, 'preview-font.ttf');
  await copyFile(join(process.env.SystemRoot || 'C:\\Windows', 'Fonts', 'consola.ttf'), sourceFont);
  const chooseFile = async (path: string) =>
    app.evaluate(({ dialog }, selected) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [selected],
      })) as typeof dialog.showOpenDialog;
    }, path);
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.id = 'test-font-drop';
    document.body.appendChild(input);
  });
  await page.locator('#test-font-drop').setInputFiles(sourceFont);
  await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('#test-font-drop')!;
    const transfer = new DataTransfer();
    transfer.items.add(input.files![0]);
    document
      .querySelector('.font-picker')!
      .dispatchEvent(
        new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }),
      );
    input.remove();
  });
  await page.waitForFunction(() =>
    [...document.fonts].some(
      (font) => font.family.startsWith('CShell-') && font.status === 'loaded',
    ),
  );
  await chooseFile(sourceFont);
  await page.locator('.settings-nav').getByRole('button', { name: '终端', exact: true }).click();
  await page.getByRole('button', { name: '导入字体文件', exact: true }).last().click();
  await page.waitForFunction(() =>
    [...document.fonts].some(
      (font) => font.family.startsWith('CShell-') && font.status === 'loaded',
    ),
  );
  const invalid = join(data, 'invalid.ttf');
  await writeFile(invalid, 'not a font');
  await chooseFile(invalid);
  await page.locator('.settings-nav').getByRole('button', { name: '外观', exact: true }).click();
  await page.getByRole('button', { name: '导入字体文件', exact: true }).first().click();
  await page.getByRole('alert').filter({ hasText: '字体加载失败' }).waitFor();
  const imagePath = join(data, 'background.png');
  const image = await app.evaluate(({ nativeImage }) => {
    const width = 256,
      height = 160,
      pixels = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const index = (y * width + x) * 4;
        pixels[index] = Math.round(100 + x / 2);
        pixels[index + 1] = Math.round(y / 2);
        pixels[index + 2] = 60;
        pixels[index + 3] = 255;
      }
    return nativeImage.createFromBitmap(pixels, { width, height }).toPNG().toString('base64');
  });
  await writeFile(imagePath, Buffer.from(image, 'base64'));
  await chooseFile(imagePath);
  await page.getByRole('button', { name: '选择图片', exact: true }).click();
  await page.locator('.workbench-background').waitFor({ state: 'attached' });
  await page.getByRole('slider', { name: /图片透明度/ }).fill('0.3');
  assert.equal(
    await page.locator('.workbench-background').evaluate((el) => getComputedStyle(el).opacity),
    '0.3',
  );
  await page.locator('.settings-nav').getByRole('button', { name: '工作区', exact: true }).click();
  await page.getByRole('textbox', { name: '配置名称', exact: true }).fill('Night workspace');
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await page.waitForFunction(async () =>
    (await window.cshell.presets()).some((p) => p.name === 'Night workspace'),
  );
  const exportPath = join(data, 'workspace-export.json');
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = (async () => ({
      canceled: false,
      filePath,
    })) as typeof dialog.showSaveDialog;
  }, exportPath);
  await page.getByRole('button', { name: '导出配置', exact: true }).click();
  await page.waitForFunction(async () => (await window.cshell.presets()).length === 1);
  // Wait for the actual export file without sleeping in the application.
  let bundle: any;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      bundle = JSON.parse(await readFile(exportPath, 'utf8'));
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  assert.ok(bundle?.assets.length);
  assert.equal(bundle.secrets, undefined);
  assert.equal(bundle.mcp, undefined);
  await page.locator('.settings-nav').getByRole('button', { name: '外观', exact: true }).click();
  await page.getByRole('button', { name: '移除图片', exact: true }).click();
  await chooseFile(exportPath);
  await page.locator('.settings-nav').getByRole('button', { name: '工作区', exact: true }).click();
  await page.getByRole('button', { name: '导入配置', exact: true }).click();
  await page.locator('.workbench-background').waitFor({ state: 'attached' });
  await page.screenshot({ path: 'test-results/appearance-settings.png' });
  await page
    .locator('.editor-page:visible')
    .getByRole('button', { name: '保存', exact: true })
    .click();
  const saved = await page.evaluate(() => window.cshell.config());
  assert.ok(saved.preferences.terminalFontAsset);
  assert.ok(saved.preferences.backgroundAsset);
  const fontData = await page.evaluate(
    (id) => window.cshell.appearanceData(id),
    saved.preferences.terminalFontAsset.id,
  );
  assert.ok(fontData.startsWith('data:font/ttf;base64,'));
  await rm(sourceFont);
  await rm(imagePath);
  await page.evaluate(
    (id) => window.cshell.appearanceData(id),
    saved.preferences.backgroundAsset.id,
  );
  const disk = JSON.parse(await readFile(join(data, 'config.json'), 'utf8'));
  assert.equal(disk.preferences.backgroundOpacity, 0.3);
  const rejected = await page.evaluate(async () => {
    try {
      await window.cshell.appearanceData('../config.json');
      return false;
    } catch {
      return true;
    }
  });
  assert.equal(rejected, true);
  await settingsButton.click();
  await page.locator('.settings-nav').getByRole('button', { name: '外观', exact: true }).click();
  await page.getByRole('button', { name: '移除图片', exact: true }).click();
  await page.locator('.workbench-background').waitFor({ state: 'detached' });
  await page
    .locator('.editor-page:visible')
    .getByRole('button', { name: '取消', exact: true })
    .click();
  await page.locator('.workbench-background').waitFor({ state: 'attached' });
  console.log(
    'PASS: actual Windows font enumeration, font import and validation, live preview/cancel, local background persistence and removal, tooltip hover/focus, asset path isolation',
  );
}
