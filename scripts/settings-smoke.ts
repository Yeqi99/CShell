import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
const data = await mkdtemp(join(tmpdir(), 'cshell-settings-'));
const env = { ...process.env, CSHELL_TEST_DATA: data };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.'], env });
try {
  const page = await app.firstWindow();
  await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
  await page.locator('.topbar button').last().click();
  const nav = page.locator('.settings-nav');
  assert.deepEqual(await nav.getByRole('button').allTextContents(), [
    '账号与云同步',
    '外观',
    '终端',
    ...(process.platform === 'win32' ? ['本机终端'] : []),
    '工作区',
    '网络与代理',
    '扩展',
    'AI 与安全',
    '关于与更新',
  ]);
  await mkdir('test-results', { recursive: true });
  await page.getByText(/本机已安装字体/).waitFor();
  await page.screenshot({ animations: 'disabled', path: 'test-results/settings-appearance.png' });
  await nav.getByRole('button', { name: '终端', exact: true }).click();
  await page.getByLabel('终端字号', { exact: true }).fill('17');
  await nav.getByRole('button',{name:'账号与云同步',exact:true}).click();
  await page.getByRole('heading',{name:'账号与云同步 · Pro'}).waitFor();
  await page.getByLabel('邮箱',{exact:true}).fill('draft@example.com');
  assert.equal(await page.locator('.settings-savebar .primary').isVisible(),false);
  await page.screenshot({path:'test-results/settings-cloud.png'});
  await nav.getByRole('button',{name:'外观',exact:true}).click();
  await nav.getByRole('button',{name:'账号与云同步',exact:true}).click();
  assert.equal(await page.getByLabel('邮箱',{exact:true}).inputValue(),'draft@example.com');
  await nav.getByRole('button', { name: '工作区', exact: true }).click();
  await page.screenshot({ animations: 'disabled', path: 'test-results/settings-workspace.png' });
  await nav.getByRole('button', { name: '终端', exact: true }).click();
  assert.equal(await page.getByLabel('终端字号', { exact: true }).inputValue(), '17');
  await page.screenshot({ animations: 'disabled', path: 'test-results/settings-terminal.png' });
  await nav.getByRole('button', { name: '关于与更新', exact: true }).click();
  await page.screenshot({ animations: 'disabled', path: 'test-results/settings-updates.png' });
  await page
    .locator('.settings-savebar')
    .getByRole('button', { name: '保存', exact: true })
    .click();
  await page.locator('.categorized-settings').waitFor({ state: 'hidden' });
  assert.equal(
    await page.evaluate(async () => (await window.cshell.config()).preferences.fontSize),
    17,
  );
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 650));
  await page.locator('.topbar button').last().click();
  await nav.getByRole('button', { name: '外观', exact: true }).click();
  await page.getByRole('combobox', { name: '外观', exact: true }).selectOption('dark');
  await page.screenshot({ animations: 'disabled', path: 'test-results/settings-dark-narrow.png' });
  assert.equal(
    await page.locator('.settings-content').evaluate((el) => el.scrollWidth <= el.clientWidth),
    true,
  );
  const footer = await page.locator('.settings-savebar').boundingBox();
  assert.ok(footer && footer.y + footer.height <= (await page.evaluate(() => innerHeight)));
  await page
    .locator('.settings-savebar')
    .getByRole('button', { name: '取消', exact: true })
    .click();
  assert.equal(
    await page.evaluate(async () => (await window.cshell.config()).preferences.theme),
    'light',
  );
  console.log(
    'PASS: categorized navigation, draft preservation, save from another category, cancel preview, dark/narrow layout and unobstructed footer',
  );
} finally {
  await app.close();
  await rm(data, { recursive: true, force: true });
}
