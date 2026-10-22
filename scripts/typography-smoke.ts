import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
async function main() {
  const directory = await mkdtemp(join(tmpdir(), 'cshell-type-test-'));
  const env = { ...process.env, CSHELL_TEST_DATA: directory }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.'], env });
  try {
    const page = await app.firstWindow(); page.setDefaultTimeout(15000);
    await page.locator('.sidebar').getByRole('button', { name: '新建连接', exact: true }).click();
    await page.getByRole('button', { name: '批量导入连接', exact: true }).click();
    await page.getByRole('textbox', { name: '批量连接文本' }).fill('ssh root@production.example\nssh deploy@development.example');
    await page.getByRole('button', { name: '预览连接', exact: true }).click();
    await page.getByRole('button', { name: '确认导入 2 条', exact: true }).click();
    await page.locator('.server-open strong').first().waitFor();
    assert.equal(await page.locator('.server-open strong').first().evaluate(e => getComputedStyle(e).fontSize), '15px');
    await page.getByTitle('偏好设置', { exact: true }).click();
    await page.getByLabel('界面字号', { exact: true }).fill('17');
    await page.getByLabel('连接名称字号', { exact: true }).fill('19');
    await page.getByLabel('分组标题字号', { exact: true }).fill('17');
    await page.getByLabel('侧边栏间距', { exact: true }).selectOption('spacious');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.server-open strong')!).fontSize === '19px');
    await mkdir('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/typography-custom.png' });
    await page.getByRole('button', { name: '保存', exact: true }).click();
    assert.equal((await page.evaluate(() => window.cshell.config())).preferences.sidebarFontSize, 19);
    await page.getByTitle('偏好设置', { exact: true }).click();
    await page.getByRole('button', { name: '恢复界面字体与间距', exact: true }).click();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.server-open strong')!).fontSize === '15px');
    await page.screenshot({ path: 'test-results/typography-default.png' });
    console.log('PASS: sidebar defaults, live custom preview, persisted settings and reset');
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await app.close().catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
