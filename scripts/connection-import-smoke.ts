import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
async function main() {
  const directory = await mkdtemp(join(tmpdir(), 'cshell-import-ui-'));
  const source = join(directory, 'fixture.csv');
  await writeFile(source, 'Server,Account,Secret\none.example,deploy,test-password\ntwo.example,root,second-password');
  const env = { ...process.env, CSHELL_TEST_DATA: directory }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.'], env });
  try {
    const page = await app.firstWindow(); page.setDefaultTimeout(12000);
    await page.locator('.sidebar').getByRole('button', { name: '新建连接', exact: true }).click();
    await page.getByRole('button', { name: '批量导入连接', exact: true }).click();
    await page.getByRole('textbox', { name: '批量连接文本' }).fill('ssh root@first.example\nssh deploy@second.example');
    await page.getByRole('button', { name: '预览连接', exact: true }).click();
    assert.equal((await page.evaluate(() => window.cshell.config())).profiles.length, 0);
    await page.getByRole('button', { name: '确认导入 2 条', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '已导入 2 条连接' }).waitFor();
    assert.equal((await page.evaluate(() => window.cshell.config())).profiles.length, 2);
    await app.evaluate(({ dialog }, source) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] });
    }, source);
    await page.getByRole('button', { name: '选择 CSV 文件', exact: true }).click();
    await page.getByRole('combobox', { name: '地址列', exact: true }).selectOption('0');
    await page.getByRole('combobox', { name: '用户名列', exact: true }).selectOption('1');
    await page.getByRole('combobox', { name: '密码列', exact: true }).selectOption('2');
    await page.getByRole('button', { name: '更新预览', exact: true }).click();
    assert.equal((await page.locator('.batch-import').innerText()).includes('test-password'), false);
    await mkdir('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/connection-import.png' });
    await page.getByRole('button', { name: '确认导入 2 条', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '已导入 2 条连接' }).waitFor();
    assert.equal((await page.evaluate(() => window.cshell.config())).profiles.length, 4);
    await page.getByRole('button', { name: '返回新建连接', exact: true }).click();
    await page.getByRole('button', { name: 'SSH 终端', exact: true }).click();
    await page.getByRole('textbox', { name: '主机地址', exact: true }).waitFor();
    console.log('PASS: multiple-text preview/confirm, CSV mapping/masked credentials, sidebar refresh and original form navigation');
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await app.close().catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
