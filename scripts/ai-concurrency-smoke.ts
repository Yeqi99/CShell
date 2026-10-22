import { _electron as electron } from 'playwright';
import { createServer, type ServerResponse } from 'node:http';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

async function main() {
  const directory = await mkdtemp(join(tmpdir(), 'cshell-concurrency-'));
  const pending = new Set<ServerResponse>();
  let requests = 0;
  const server = createServer(async (req, res) => {
    for await (const _ of req) { /* drain fixture request */ }
    requests++;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: '处理中' } }] }) + '\n\n');
    pending.add(res);
    res.on('close', () => pending.delete(res));
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const env = { ...process.env, CSHELL_TEST_DATA: directory };
  delete env.ELECTRON_RUN_AS_NODE;
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  const launch = () => electron.launch({ args: ['.'], env });
  try {
    app = await launch();
    let page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    await page.evaluate(async ({ id, port }) => {
      await window.cshell.aiProviderSave({ id, name: '并行测试', model: 'fixture', url: `http://127.0.0.1:${port}/v1` });
    }, { id: randomUUID(), port });
    await page.getByRole('button', { name: 'AI 智能体', exact: true }).click();
    const panel = page.getByRole('complementary', { name: 'AI 智能体' });
    await panel.getByRole('textbox', { name: '发送给智能体' }).fill('任务 A');
    await panel.getByRole('button', { name: '发送', exact: true }).click();
    await page.waitForFunction(async () => (await window.cshell.aiSnapshot()).threads.some(t => t.title === '任务 A' && t.state === 'running'));
    await panel.getByRole('textbox', { name: '发送给智能体' }).fill('A 的后续草稿');
    await panel.getByRole('button', { name: '新建 AI 会话' }).click();
    await panel.getByRole('textbox', { name: '发送给智能体' }).fill('任务 B');
    await panel.getByRole('button', { name: '发送', exact: true }).click();
    await page.waitForFunction(async () => (await window.cshell.aiSnapshot()).threads.filter(t => t.state === 'running').length === 2);
    await panel.getByRole('button', { name: /1 个会话在后台进行/ }).click();
    await panel.getByRole('button', { name: /任务 A.*正在执行/ }).click();
    assert.equal(await panel.getByRole('textbox', { name: '发送给智能体' }).inputValue(), 'A 的后续草稿');
    await panel.getByRole('button', { name: '停止 AI', exact: true }).click();
    await page.waitForFunction(async () => {
      const threads = (await window.cshell.aiSnapshot()).threads;
      return threads.find(t => t.title === '任务 A')?.state === 'error' && threads.find(t => t.title === '任务 B')?.state === 'running';
    });
    await mkdir('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/ai-concurrency.png' });
    await app.close(); app = undefined;
    const before = requests;
    app = await launch();
    page = await app.firstWindow();
    const threads = await page.evaluate(async () => (await window.cshell.aiSnapshot()).threads);
    assert.equal(threads.length, 2);
    assert.ok(threads.every(t => t.state !== 'running' && !t.pending));
    assert.equal(requests, before, 'restart must not replay requests');
    console.log('PASS: parallel conversations, independent drafts, scoped stop and restart without replay');
  } finally {
    if (app) {
      // The second fixture has no live work; explicitly exit its test process.
      await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
      await app.close().catch(() => {});
    }
    pending.forEach(res => res.end());
    server.closeAllConnections();
    await new Promise<void>(r => server.close(() => r()));
    await rm(directory, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
