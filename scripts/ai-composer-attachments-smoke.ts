import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron } from 'playwright';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQx8AAAAASUVORK5CYII=';
const sample = 'attachment-fixture-文件正文';
const requests: string[] = [];
const server = createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  requests.push(raw);
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.end('data: {"choices":[{"delta":{"content":"附件测试完成"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
});
const directory = await mkdtemp(join(tmpdir(), 'cshell-ai-attachments-'));
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const env = { ...process.env, CSHELL_TEST_DATA: directory };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.'], env });
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  await page.waitForFunction(() => !!window.cshell?.aiProviderSave);
  await page.evaluate(async port => {
    const id = crypto.randomUUID();
    await window.cshell.aiProviderSave({ id, name: 'Attachment test', model: 'test', url: 'http://127.0.0.1:' + port + '/v1' });
  }, (server.address() as {port:number}).port);
  await page.getByRole('button', { name: 'AI 智能体', exact: true }).click();
  const composer = page.getByLabel('发送给智能体');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', {name:'添加图片或文件'}).click();
  await (await chooser).setFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from(sample) });
  const dataTransfer = await page.evaluateHandle(base64 => {
    const dt = new DataTransfer();
    dt.items.add(new File([Uint8Array.from(atob(base64), char => char.charCodeAt(0))], 'screen.png', {type:'image/png'}));
    return dt;
  }, png);
  await composer.dispatchEvent('drop', { dataTransfer });
  await page.getByRole('button', {name:'移除 screen.png'}).waitFor();
  await page.getByRole('button', {name:'移除 screen.png'}).click();
  await composer.evaluate((element, clipboardData) => {
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  }, dataTransfer);
  await page.getByRole('button', {name:'移除 screen.png'}).waitFor();
  await composer.press('Enter');
  await page.getByText('附件测试完成', {exact:true}).waitFor();
  assert(requests.some(body => body.includes(png) && body.includes(sample)), 'Model request must contain image and actual file text');
  assert.equal(await page.getByLabel('待发送附件').count(), 0);
  console.log('PASS picker, drop, remove, clipboard paste, attachment-only Enter, contents delivered to test model, draft cleared after acceptance');
} finally {
  await app.close();
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await rm(directory, { recursive:true, force:true, maxRetries:4, retryDelay:200 });
}
