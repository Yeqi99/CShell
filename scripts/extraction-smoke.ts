import { _electron as electron } from 'playwright';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
const data = await mkdtemp(join(tmpdir(), 'cshell-extract-'));
let requests = 0;
const api = createServer(async (req, res) => {
  for await (const _chunk of req) {
    /* Consume the request. */
  }
  requests++;
  res.setHeader('Content-Type', 'application/json');
  res.end(
    JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              providerId: 'cshell.ssh',
              fields: { host: 'example.test', username: 'developer', port: 2222 },
            }),
          },
        },
      ],
    }),
  );
});
await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));
const env = { ...process.env, CSHELL_TEST_DATA: data };
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
  const provider = {
    id: randomUUID(),
    name: 'Local test',
    url: `http://127.0.0.1:${(api.address() as any).port}/v1`,
    model: 'test',
  };

  await page.getByRole('button', { name: '新建连接', exact: true }).first().click();
  if (await page.getByRole('button', { name: 'SSH 终端', exact: true }).isVisible())
    await page.getByRole('button', { name: 'SSH 终端', exact: true }).click();
  const form = page.locator('.connection-editor:visible');
  await form.getByLabel('主机地址').fill('manual.example');
  await form.getByRole('button', { name: '从文本填写', exact: true }).click();
  const extract = page.locator('.connection-extract-panel');
  assert.equal(await extract.getByRole('button', { name: 'AI 模型', exact: true }).count(), 0);
  await extract.getByLabel('待提取文本').fill('主机：rules.test  端口：2200  用户名：admin');
  await extract.getByRole('button', { name: '提取并填写', exact: true }).click();
  await extract.waitFor({ state: 'hidden' });
  assert.equal(await form.getByLabel('主机地址').inputValue(), 'rules.test');
  assert.equal(await form.getByLabel('端口').inputValue(), '2200');
  assert.equal(requests, 0);
  await form.getByRole('button', { name: '从文本填写', exact: true }).click();
  await extract.getByLabel('待提取文本').fill('host: one.test\nhost: two.test');
  await extract.getByRole('button', { name: '提取并填写', exact: true }).click();
  await extract.getByRole('alert').filter({ hasText: '相互冲突' }).waitFor();
  assert.equal(await form.getByLabel('主机地址').inputValue(), 'rules.test');
  await page.evaluate((p) => window.cshell.aiProviderSave(p), provider);
  await extract.getByRole('button', { name: 'AI 模型', exact: true }).click();
  await extract.getByLabel('待提取文本').fill('Connect developer to example.test on port 2222');
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/connection-extraction.png' });
  assert.equal(await extract.getByLabel('提取使用的 AI 基座').inputValue(), provider.id);
  assert.equal(requests, 0);
  await extract.getByRole('button', { name: '提取并填写', exact: true }).click();
  await extract.waitFor({ state: 'hidden' });
  assert.equal(await form.getByLabel('主机地址').inputValue(), 'example.test');
  assert.equal(await form.getByLabel('用户名').inputValue(), 'developer');
  assert.equal(await form.getByLabel('端口').inputValue(), '2222');
  await form.getByLabel('主机地址').fill('edited.example');
  assert.equal(await page.locator('.session-tab').count(), 0);
  assert.equal((await page.evaluate(() => window.cshell.aiSnapshot())).threads.length, 0);
  assert.equal((await page.evaluate(() => window.cshell.config())).profiles.length, 0);
  assert.equal(requests, 1);
  console.log(
    'PASS: offline rules, ambiguous details preserve form, no-provider AI hidden, configured default AI, explicit extraction, editable manual form, no automatic connection or saved profile/chat',
  );
} finally {
  await app.close();
  await new Promise<void>((resolve) => api.close(() => resolve()));
  await rm(data, { recursive: true, force: true });
}
