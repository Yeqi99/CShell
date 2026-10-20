import { _electron as electron } from 'playwright';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fixture } from '../tests/fixture';
import { apiTerminalResponseSmoke } from './api-terminal-response-smoke';

const data = await mkdtemp(join(tmpdir(), 'cshell-terminal-response-'));
const server = await fixture();
const env = { ...process.env, CSHELL_TEST_DATA: data };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.'], env });
try {
  await mkdir('test-results', { recursive: true });
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox;
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
  await page.getByRole('button', { name: '新建连接', exact: true }).first().click();
  await page.getByRole('button', { name: 'SSH 终端', exact: true }).click();
  const editor = page.locator('.editor-page:visible');
  await editor.getByLabel('保存到服务器列表').check();
  await editor.getByLabel('名称', { exact: true }).fill('API response fixture');
  await editor.getByLabel('主机地址').fill('127.0.0.1');
  await editor.getByLabel('端口').fill(String(server.port));
  await editor.getByLabel('用户名').fill('tester');
  await editor.locator('.connection-secret input').fill(server.password);
  await editor.getByLabel('使用系统加密保存凭据').check();
  await editor.getByRole('button', { name: '保存并连接', exact: true }).click();
  await editor.waitFor({ state: 'hidden' });
  await page.getByText('hello.txt', { exact: true }).waitFor();
  await apiTerminalResponseSmoke(app, page);
} finally {
  await app.close();
  await server.close();
  await rm(data, { recursive: true, force: true });
}
