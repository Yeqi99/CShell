import { _electron as electron } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

const directory = await mkdtemp(join(tmpdir(), 'cshell-stream-ui-'));
let finish: (() => void) | undefined;
let calls = 0;
const api = createServer(async (req, res) => {
  let raw = '';
  for await (const part of req) raw += part;
  const body = JSON.parse(raw);
  calls++;
  assert.equal(body.stream, true);
  res.setHeader('content-type', 'text/event-stream');
  res.write(
    'data: ' +
      JSON.stringify({ choices: [{ index: 0, delta: { content: '正在逐字回复' } }] }) +
      '\n\n',
  );
  finish = () =>
    res.end(
      'data: ' +
        JSON.stringify({
          choices: [{ index: 0, delta: { content: '，已完成。' }, finish_reason: 'stop' }],
        }) +
        '\n\ndata: [DONE]\n\n',
    );
});
await new Promise<void>((r) => api.listen(0, '127.0.0.1', r));
const env = { ...process.env, CSHELL_TEST_DATA: directory };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  ...(process.env.CSHELL_EXECUTABLE
    ? { executablePath: process.env.CSHELL_EXECUTABLE, args: [] }
    : { args: ['.'] }),
  env,
});
try {
  const page = await app.firstWindow();
  await page.getByRole('heading', { name: '尚未连接' }).waitFor();
  await page.getByRole('button', { name: 'AI 智能体', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'AI 智能体' });
  await panel.getByRole('heading', { name: '连接你的 AI' }).waitFor();
  assert.equal(await panel.getByLabel('发送给智能体').isVisible(), false);
  await page.locator('.sidebar-search input').fill('选择这些文字');
  await page.locator('.sidebar-search input').selectText();
  await page.locator('.sidebar-search input').click({ button: 'right' });
  assert.equal(await page.getByRole('menuitem', { name: '我想……', exact: true }).count(), 0);
  await page.keyboard.press('Escape');
  const provider = {
    id: crypto.randomUUID(),
    name: 'Stream fixture',
    model: 'test',
    url: `http://127.0.0.1:${(api.address() as any).port}/v1`,
  };
  await page.evaluate((p) => window.cshell.aiProviderSave(p), provider);
  await panel.getByLabel('发送给智能体').waitFor({ state: 'visible' });
  await panel.getByLabel('发送给智能体').fill('测试流式显示');
  await panel.getByLabel('发送给智能体').press('Enter');
  // The server deliberately holds the response open until visible partial text is verified.
  await panel.getByText('正在逐字回复', { exact: true }).waitFor();
  assert.equal((await page.evaluate(() => window.cshell.aiSnapshot())).threads[0].state, 'running');
  await panel.getByRole('button', { name: '停止 AI' }).waitFor();
  finish!();
  await panel.getByText('正在逐字回复，已完成。', { exact: true }).waitFor();
  await panel.getByRole('button', { name: '停止 AI' }).waitFor({ state: 'hidden' });
  await panel.getByLabel('发送给智能体').fill('测试停止');
  await panel.getByLabel('发送给智能体').press('Enter');
  await panel.getByText('正在逐字回复', { exact: true }).waitFor();
  await panel.getByRole('button', { name: '停止 AI' }).click();
  await panel.getByRole('alert').filter({ hasText: '已停止' }).waitFor();
  finish!();
  assert.equal(calls, 2);
  await page.evaluate((id) => window.cshell.aiProviderDelete(id), provider.id);
  await panel.getByLabel('发送给智能体').waitFor({ state: 'hidden' });
  console.log(
    'PASS: no-provider AI actions hidden; partial reply visible before stream closes; stop cancels response; provider removal hides composer',
  );
} finally {
  finish?.();
  await app.close();
  await new Promise<void>((r) => api.close(() => r()));
  await rm(directory, { recursive: true, force: true });
}
