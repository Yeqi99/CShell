import assert from 'node:assert/strict';
import type { Page } from 'playwright';
export async function groupsSmoke(page: Page) {
  const sidebar = page.locator('.sidebar');
  const create = async (name: string) => {
    await sidebar.getByRole('button', { name: '新建分组', exact: true }).click();
    await sidebar.locator('.group-editor input').fill(name);
    await sidebar.getByRole('button', { name: '保存分组', exact: true }).click();
    await sidebar.locator('.group-editor').waitFor({ state: 'hidden' });
    await page.waitForFunction(
      async (name) => (await window.cshell.config()).groups.includes(name),
      name,
    );
  };
  await create('Production');
  await create('Empty group');
  await sidebar.getByRole('button', { name: '新建分组', exact: true }).click();
  await sidebar.locator('.group-editor input').fill('Production');
  await sidebar.getByRole('button', { name: '保存分组', exact: true }).click();
  await sidebar.getByRole('alert').filter({ hasText: '已存在同名分组' }).waitFor();
  await sidebar.locator('.group-editor').getByRole('button', { name: '取消', exact: true }).click();
  const trigger = sidebar.getByRole('button', {
    name: '连接操作 · Local integration',
    exact: true,
  });
  const before = await sidebar.locator('.server-row').boundingBox();
  await trigger.click();
  await page.getByRole('menu', { name: '连接操作', exact: true }).waitFor();
  assert.deepEqual(await sidebar.locator('.server-row').boundingBox(), before);
  await page.screenshot({ path: 'test-results/server-actions-light.png' });
  await page.keyboard.press('Escape');
  await page.waitForFunction((el) => document.activeElement === el, await trigger.elementHandle());
  assert.equal(await trigger.evaluate((el) => document.activeElement === el), true);
  await trigger.click();
  await page.getByRole('menuitem', { name: '移至分组', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Production', exact: true }).click();
  await page.waitForFunction(
    async () => (await window.cshell.config()).profiles[0].group === 'Production',
  );
  await sidebar.getByRole('button', { name: '管理分组 · Production', exact: true }).click();
  await page.getByRole('menuitem', { name: '重命名分组', exact: true }).click();
  await sidebar.locator('.group-editor input').fill('Operations');
  await sidebar.getByRole('button', { name: '保存分组', exact: true }).click();
  await page.waitForFunction(
    async () => (await window.cshell.config()).profiles[0].group === 'Operations',
  );
  await sidebar.getByRole('button', { name: '管理分组 · Operations', exact: true }).click();
  await page.screenshot({ path: 'test-results/group-actions-light.png' });
  await page.getByRole('menuitem', { name: '删除分组', exact: true }).click();
  await page.waitForFunction(async () => {
    const c = await window.cshell.config();
    return (
      c.profiles.length === 1 && c.profiles[0].group === '' && !c.groups.includes('Operations')
    );
  });
  assert.equal(await page.getByRole('dialog').count(), 0);
  await trigger.click();
  await page.getByRole('menuitem', { name: '移至分组', exact: true }).click();
  await page.getByRole('menuitem', { name: '新建分组', exact: true }).click();
  await sidebar.locator('.group-editor input').fill('Created from connection');
  await sidebar.getByRole('button', { name: '保存分组', exact: true }).click();
  await page.waitForFunction(async () => {
    const c = await window.cshell.config();
    return (
      c.groups.includes('Created from connection') &&
      c.profiles[0].group === 'Created from connection'
    );
  });
  console.log(
    'PASS: discoverable group creation, duplicate rejection, contextual menu without layout shift, keyboard focus return, move/rename/delete preserving connections',
  );
}
