import { _electron as electron } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const data = await mkdtemp(join(tmpdir(), 'cshell-text-ui-'));
const requests: any[] = [];
const api = createServer(async (req, res) => {
  let raw = '';
  for await (const part of req) raw += part;
  const body = JSON.parse(raw);
  requests.push(body);
  let kind = 'chat';
  try {
    kind = JSON.parse(body.messages.at(-1).content).kind || 'chat';
  } catch {}
  const content =
    kind === 'compose'
      ? '["查看当前目录","列出当前文件","检查目录大小"]'
      : kind === 'translate'
        ? '这是翻译后的内容。'
        : '- **名称**: 机器一\n\n目前**没有已建立的会话**，可以连接。';
  res.setHeader('content-type', 'text/event-stream');
  res.end(
    'data: ' +
      JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: 'stop' }] }) +
      '\n\ndata: [DONE]\n\n',
  );
});
await new Promise<void>((r) => api.listen(0, '127.0.0.1', r));
const env = { ...process.env, CSHELL_TEST_DATA: data };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  args: process.env.CSHELL_EXECUTABLE ? [] : ['.'],
  ...(process.env.CSHELL_EXECUTABLE ? { executablePath: process.env.CSHELL_EXECUTABLE } : {}),
  env,
});
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  await page.addInitScript('window.__name = (fn) => fn');
  await app.evaluate('globalThis.__name = (fn) => fn');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
  await page.evaluate(
    async ({ id, url }) => {
      await window.cshell.saveProfile({
        id,
        name: '机器一',
        host: '192.0.2.1',
        port: 22,
        username: 'dev',
        auth: 'password',
        group: '开发',
        favorite: false,
      });
      await window.cshell.aiProviderSave(
        { id: crypto.randomUUID(), name: '测试基座', model: 'fixture', url },
        'fixture-key',
      );
    },
    { id: randomUUID(), url: `http://127.0.0.1:${(api.address() as any).port}/v1` },
  );
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('local-terminal:targets');
    ipcMain.handle('local-terminal:targets', () => [
      {
        id: 'wsl:Fixture',
        name: 'Fixture Linux',
        detail: '本机 Linux · WSL',
        shell: 'wsl:Fixture',
      },
    ]);
    ipcMain.removeHandler('local-terminal:wsl-account');
    ipcMain.handle('local-terminal:wsl-account', () => ({ ready: false }));
  });
  await page.reload();
  await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
  await page.getByRole('button', { name: '新建连接', exact: true }).click();
  await page.getByRole('heading', { name: '新建连接', exact: true }).waitFor();
  assert.equal(await page.getByLabel('主机地址', { exact: true }).isVisible(), false);
  await page.getByRole('button', { name: 'SSH 终端', exact: true }).click();
  await page.getByLabel('主机地址', { exact: true }).fill('draft.example');
  await page.getByRole('button', { name: '返回连接方式', exact: true }).click();
  await page.getByRole('button', { name: 'SSH 终端', exact: true }).click();
  assert.equal(await page.getByLabel('主机地址', { exact: true }).inputValue(), 'draft.example');
  await page
    .locator('.sidebar')
    .getByRole('button', { name: /Fixture Linux/ })
    .dblclick();
  await page.getByRole('heading', { name: '设置 Fixture' }).waitFor();
  assert.equal(await page.locator('.wsl-account input[type=password]').count(), 2);
  await page.getByRole('button', { name: '稍后设置' }).click();
  assert.equal(await page.getByLabel('主机地址', { exact: true }).inputValue(), 'draft.example');

  // Use real selection and the context menu. No request is sent until the user submits.
  await page.getByRole('button', { name: '返回连接方式', exact: true }).click();
  const paragraph = page.locator('.connection-start-heading p');
  await paragraph.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
  });
  await paragraph.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'AI 分析', exact: true }).click();
  const input = page.getByLabel('发送给智能体');
  await page.waitForFunction(() =>
    document
      .querySelector<HTMLTextAreaElement>('[aria-label="发送给智能体"]')
      ?.value.endsWith('我的问题：\n'),
  );
  assert.equal(requests.length, 0);
  assert.equal((await page.evaluate(() => window.cshell.aiSnapshot())).threads.length, 1);
  await input.press('End');
  await input.press('x');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.locator('.agent-markdown strong').filter({ hasText: '名称' }).waitFor();
  assert.equal(
    await page.locator('.agent-markdown strong').filter({ hasText: '没有已建立的会话' }).count(),
    1,
  );

  // Insertion replaces only the selection and never submits the candidate.
  await input.fill('未发送的草稿');
  const selected = page.locator('.agent-markdown strong').first();
  await selected.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
  });
  await selected.dispatchEvent('contextmenu', { clientX: 1200, clientY: 500 });
  await page.getByRole('menuitem', { name: 'AI 分析', exact: true }).click();
  await page.waitForFunction(() =>
    document
      .querySelector<HTMLTextAreaElement>('[aria-label="发送给智能体"]')
      ?.value.includes('未发送的草稿\n\n名称'),
  );
  assert.equal((await page.evaluate(() => window.cshell.aiSnapshot())).threads.length, 1);
  assert.equal(requests.length, 1);
  await input.fill('保留前缀 [这里] 保留后缀');
  await input.evaluate((el) => el.setSelectionRange(5, 9));
  await input.dispatchEvent('contextmenu', { clientX: 1200, clientY: 700 });
  await page.getByRole('menuitem', { name: '我想……' }).click();
  await page.getByLabel('描述想法').fill('帮我描述目录查询');
  await page.getByLabel('描述想法').press('Enter');
  await page.locator('.text-assist-choices button').first().waitFor();
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/text-assist-choices.png' });
  const count = requests.length;
  await page.locator('.text-assist-choices button').first().click();
  assert.equal(await input.inputValue(), '保留前缀 查看当前目录 保留后缀');
  assert.equal(requests.length, count);

  // Terminal-like incremental source, cache, original toggle and cancellation.
  await page.evaluate(() => {
    (window as any).translationFixture = Array.from({ length: 20 }, (_, i) => 'Output ' + i).join(
      '\n',
    );
    window.dispatchEvent(
      new CustomEvent('cshell:text-assist', {
        detail: {
          mode: 'translate',
          text: (window as any).translationFixture,
          label: '测试输出',
          read: () => (window as any).translationFixture,
        },
      }),
    );
  });
  await page.locator('.text-assist-result').getByText('这是翻译后的内容。').waitFor();
  const before = requests.length;
  await page.getByRole('button', { name: '原文', exact: true }).click();
  await page.getByRole('button', { name: '译文', exact: true }).click();
  await page.waitForTimeout(1200);
  assert.equal(requests.length, before);
  await page.getByLabel('自动翻译增量').check();
  await page.evaluate(() => ((window as any).translationFixture += '\nNew incremental output'));
  await page.waitForFunction(
    () =>
      document.querySelector('.text-assist-result')?.textContent?.split('这是翻译后的内容。')
        .length === 3,
  );
  assert.equal(requests.length, before + 1);
  await page.screenshot({ path: 'test-results/text-assist-translation.png' });
  await page.getByLabel('关闭文字助手').click();

  await page.getByRole('button', { name: '极简模式 / Minimal mode', exact: true }).click();
  await app.evaluate(({ screen, BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0],
      b = w.getBounds();
    (screen as any).getCursorScreenPoint = () => ({ x: b.x + b.width / 2, y: b.y + 12 });
  });
  await page.locator('.minimal-mode.minimal-hover').waitFor();
  assert.equal(await page.locator('.tabs').evaluate((el) => getComputedStyle(el).opacity), '1');
  await app.evaluate(({ screen }) => {
    (screen as any).getCursorScreenPoint = () => ({ x: -100000, y: -100000 });
  });
  await page.locator('.minimal-mode:not(.minimal-hover)').waitFor();
  assert.deepEqual(errors, []);
  console.log(
    'PASS: real Electron connection chooser/draft, WSL machine entry/setup, selection analysis, candidate insertion, translation/cache/increment, minimal native hover',
  );
} finally {
  await app.close();
  await new Promise<void>((r) => api.close(() => r()));
  await rm(data, { recursive: true, force: true });
}
