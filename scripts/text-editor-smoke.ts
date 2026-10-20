import {_electron as electron} from 'playwright';
import {mkdtemp, mkdir, readFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import {fixture} from '../tests/fixture';

const server = await fixture();
const data = await mkdtemp(join(tmpdir(), 'cshell-text-smoke-'));
const env = {...process.env, CSHELL_TEST_DATA: data};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({args:['.'], env});
try {
  await app.evaluate(({dialog}) => {
    dialog.showMessageBox = (async () => ({response:1, checkboxChecked:false})) as typeof dialog.showMessageBox;
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.getByRole('button', {name:'新建连接', exact:true}).first().click();
  await page.getByRole('button', {name:'SSH 终端', exact:true}).click();
  const editor = page.locator('.connection-editor:visible');
  await editor.getByLabel('保存到服务器列表').uncheck();
  await editor.getByLabel('主机地址', {exact:true}).fill('127.0.0.1');
  await editor.getByLabel('端口', {exact:true}).fill(String(server.port));
  await editor.getByLabel('用户名', {exact:true}).fill('tester');
  await editor.locator('.connection-secret input').fill(server.password);
  await editor.getByRole('button', {name:'连接', exact:true}).click();
  await page.getByText('hello.txt', {exact:true}).dblclick();
  const code = page.locator('.text-file-editor .cm-content');
  await code.waitFor();
  await page.getByRole('button', {name:'展开编辑区', exact:true}).click();
  assert.equal(await page.locator('.text-file-editor.expanded').count(), 1);
  await page.getByRole('button', {name:'还原编辑区', exact:true}).click();
  assert.match(await code.innerText(), /你好/);
  await code.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('manual draft');
  assert.doesNotMatch(await readFile(join(server.root, 'hello.txt'), 'utf8'), /manual draft/);
  await page.locator('.text-file-tabs').getByRole('button', {name:'文件', exact:true}).click();
  await page.locator('.text-file-tabs').getByRole('button', {name:'hello.txt', exact:true}).click();
  assert.match(await code.innerText(), /manual draft/);
  // The fixture does not advertise atomic rename; a failed write must preserve the original.
  await page.getByLabel('同步模式').selectOption('live');
  await page.locator('.text-file-editor [role=alert]').waitFor();
  assert.doesNotMatch(await readFile(join(server.root, 'hello.txt'), 'utf8'), /manual draft/);
  assert.match(await page.locator('.text-file-editor footer').innerText(), /暂停/);
  await mkdir('test-results', {recursive:true});
  await page.screenshot({path:'test-results/text-editor-smoke.png'});
  assert.deepEqual(errors, []);
  console.log('PASS: text open, manual draft, tab preservation, live failure pause, original preserved');
} finally {
  await app.close();
  await server.close();
  await rm(data, {recursive:true, force:true});
}
