import assert from 'node:assert/strict';
import type { Page } from 'playwright';
export async function workspaceSmoke(page: Page) {
  const language = page.locator('.language-menu > button');
  await language.click();
  assert.equal(await page.locator('html').getAttribute('lang'), 'zh-CN');
  await page.screenshot({ path: 'test-results/language-menu.png' });
  assert.equal(await page.getByRole('dialog').count(), 0);
  await page.getByRole('menuitemradio', { name: 'English', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.lang === 'en-US');
  await language.click();
  await page.getByRole('menuitemradio', { name: '简体中文', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
  await page
    .locator('[data-panel="servers"] .dock-grip')
    .dragTo(page.locator('[data-panel="terminal"] .dock-grip'));
  await page.waitForFunction(
    async () => (await window.cshell.config()).preferences.layout.order[0] === 'terminal',
  );
  const separator = page.locator('[data-panel="servers"] [role="separator"]');
  await separator.focus();
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(
    async () => (await window.cshell.config()).preferences.layout.serverWidth === 228,
  );
  const rect = await separator.boundingBox();
  assert.ok(rect);
  await page.mouse.move(rect.x + 3, rect.y + 40);
  await page.mouse.down();
  await page.mouse.move(rect.x - 27, rect.y + 40);
  await page.mouse.up();
  await page.waitForFunction(
    async () => (await window.cshell.config()).preferences.layout.serverWidth === 258,
  );
  await page.keyboard.press('Control+Shift+p');
  await page.locator('.inline-finder input').fill('还原默认布局');
  await page
    .locator('.command-list')
    .getByRole('option', { name: '还原默认布局', exact: true })
    .click();
  await page.waitForFunction(
    async () =>
      (await window.cshell.config()).preferences.layout.order[0] === 'servers' &&
      (await window.cshell.config()).preferences.layout.serverWidth === 218,
  );
  console.log('PASS: in-place language menu, drag reorder, mouse/keyboard resize, restore layout');
}
