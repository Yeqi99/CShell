import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { writeFile } from 'node:fs/promises';
import type { ElectronApplication, Page } from 'playwright';
export async function mcpDesktopSmoke(app: ElectronApplication, page: Page) {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  const openSettings = async () => {
    await page.locator('.topbar button').last().click();
    await page
      .getByRole('navigation', { name: '设置分类' })
      .getByRole('button', { name: 'AI 与安全', exact: true })
      .click();
  };
  const save = () =>
    page.locator('.settings-savebar').getByRole('button', { name: '保存', exact: true }).click();
  await openSettings();
  const panel = page.locator('.mcp-settings');
  await panel.getByLabel('在本机启用 MCP').check();
  await panel.getByLabel('端口', { exact: true }).fill(String(port));
  await panel.locator('summary').filter({ hasText: 'API 与能力披露' }).click();
  await panel.getByLabel('披露模式', { exact: true }).selectOption('progressive');
  await panel.getByLabel('目录默认详情', { exact: true }).selectOption('names');
  await panel.getByLabel('目录响应预算（字节）', { exact: true }).fill('4096');
  await panel.locator('summary').filter({ hasText: 'CShell 应用权限' }).click();
  assert.equal(await panel.getByLabel('查看插件', { exact: true }).isChecked(), false);
  await panel.getByLabel('查看插件', { exact: true }).check();
  await panel.locator('summary').filter({ hasText: '本机环境范围' }).click();
  if (process.platform === 'win32') {
    await panel.getByLabel('cmd', { exact: true }).check();
    assert.equal(await panel.getByLabel('powershell', { exact: true }).isChecked(), false);
  }
  // Stub only the native picker in this isolated test app; exercise the real
  // IPC identity capture, settings draft, persistence and API permission path.
  const selectedRoot = await app.evaluate(({ app }) => app.getPath('userData'));
  await writeFile(`${selectedRoot}/api-read-fixture.txt`, 'desktop root read');
  await app.evaluate(({ dialog }, path) => {
    const original = dialog.showOpenDialog;
    dialog.showOpenDialog = (async () => {
      dialog.showOpenDialog = original;
      return { canceled: false, filePaths: [path] };
    }) as typeof dialog.showOpenDialog;
  }, selectedRoot);
  await panel.locator('summary').filter({ hasText: '本机文件读取范围' }).click();
  await panel.getByRole('button', { name: '选择只读目录', exact: true }).click();
  await panel.getByText(selectedRoot, { exact: true }).waitFor();
  await panel.locator('summary').filter({ hasText: '修改操作授权' }).click();
  assert.equal(await panel.getByLabel('创建文件', { exact: true }).isChecked(), false);
  assert.equal(await panel.getByLabel('写入文件', { exact: true }).isChecked(), false);
  assert.equal(await panel.getByLabel('移动目录树', { exact: true }).isChecked(), false);
  await panel.getByLabel('创建文件', { exact: true }).check();
  await save();
  await page.locator('.settings-savebar').waitFor({ state: 'hidden' }).catch(async (error) => {
    console.error('Settings save diagnostic:', await page.locator('body').innerText());
    console.error('Invalid fields:', await page.locator('input:invalid').evaluateAll((fields) => fields.map((field) => ({ name: (field as HTMLInputElement).name, type: (field as HTMLInputElement).type, message: (field as HTMLInputElement).validationMessage }))));
    console.error('API status:', await page.evaluate(() => window.cshell.mcpStatus()));
    throw error;
  });
  await openSettings();
  assert.equal(await panel.getByLabel('在本机启用 MCP').isChecked(), true);
  await panel.locator('summary').filter({ hasText: 'CShell 应用权限' }).click();
  assert.equal(await panel.getByLabel('查看插件', { exact: true }).isChecked(), true);
  assert.equal(
    await panel.getByLabel('管理插件（影响整个应用）', { exact: true }).isChecked(),
    false,
  );
  await panel.locator('summary').filter({ hasText: '本机环境范围' }).click();
  if (process.platform === 'win32') {
    assert.equal(await panel.getByLabel('cmd', { exact: true }).isChecked(), true);
    assert.equal(await panel.getByLabel('powershell', { exact: true }).isChecked(), false);
  }
  await panel.getByText('MCP 正在运行', { exact: true }).waitFor();
  await panel.getByRole('button', { name: '复制访问令牌', exact: true }).click();
  await panel.getByRole('button', { name: '已复制', exact: true }).waitFor();
  const token = await app.evaluate(({ clipboard }) => clipboard.readText());
  assert.ok(token.length > 32);
  const invoke = async (name: string, args: object = {}) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/invoke`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, arguments: args }),
    });
    return { status: response.status, body: await response.json() };
  };
  const roots = (await invoke('local_file_roots')).body.result.roots;
  assert.equal(roots.length, 1);
  assert.equal('path' in roots[0], false);
  assert.deepEqual(roots[0].mutations, ['create']);
  // The default review policy requires a native confirmation. Stub only the
  // isolated test instance; integration tests separately cover denial/revocation.
  await app.evaluate(({ dialog }) => {
    const original = dialog.showMessageBox;
    dialog.showMessageBox = (async () => {
      dialog.showMessageBox = original;
      return { response: 1, checkboxChecked: false };
    }) as typeof dialog.showMessageBox;
  });
  const read = await invoke('local_file_read', {
    rootId: roots[0].id,
    path: '/api-read-fixture.txt',
  });
  assert.equal(read.status, 200);
  assert.equal(Buffer.from(read.body.result.body, 'base64').toString(), 'desktop root read');
  assert.equal((await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST' })).status, 401);
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'desktop-smoke', version: '1' },
      },
    }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).result.serverInfo.name, 'CShell');
  const catalogResponse = await fetch(`http://127.0.0.1:${port}/api/v1/capabilities`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  const catalog = (await catalogResponse.json()).result;
  assert.equal(catalog.level, 'names');
  assert.ok(catalog.items.every((item: object) => !('inputSchema' in item)));
  const sampleFrames = () =>
    page.evaluate<number[]>(`new Promise((resolve) => {
          const samples = [];
          let previous = performance.now();
          const tick = (now) => {
            samples.push(now - previous);
            previous = now;
            if (samples.length === 120) resolve(samples.slice(1));
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        })`);
  const baseline = await sampleFrames();
  const loadedFrames = sampleFrames();
  const start = performance.now();
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let i = 0; i < 30; i++) {
        const reply = await fetch(`http://127.0.0.1:${port}/api/v1/invoke`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'list_servers', arguments: {} }),
        });
        assert.equal(reply.status, 200);
        assert.ok(Array.isArray((await reply.json()).result));
      }
    }),
  );
  const elapsedMs = performance.now() - start;
  const loaded = await loadedFrames;
  const summarize = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return {
      p50Ms: sorted[Math.floor(sorted.length * 0.5)],
      p95Ms: sorted[Math.floor(sorted.length * 0.95)],
      maxMs: sorted.at(-1),
    };
  };
  const frameResult = {
    measuredAt: new Date().toISOString(),
    scope:
      'Visible Electron renderer frames during 120 authenticated, audited list_servers calls at concurrency 4. Empty authorized server list; not remote terminal latency.',
    baseline: summarize(baseline),
    loaded: summarize(loaded),
    elapsedMs,
  };
  await writeFile('test-results/api-desktop-frames.json', JSON.stringify(frameResult, null, 2));
  assert.ok(
    frameResult.loaded.p95Ms < Math.max(100, frameResult.baseline.p95Ms * 3),
    'API metadata load stalls renderer frames',
  );
  await panel.locator('summary').filter({ hasText: 'API 与能力披露' }).click();
  assert.equal(await panel.getByLabel('披露模式', { exact: true }).inputValue(), 'progressive');
  assert.equal(
    await panel.getByLabel('目录响应预算（字节）', { exact: true }).inputValue(),
    '4096',
  );
  await panel.screenshot({ path: 'test-results/mcp-settings.png' });
  await panel.locator('summary').filter({ hasText: '本机文件读取范围' }).click();
  await panel.getByText(selectedRoot, { exact: true }).waitFor();
  await panel.getByRole('button', { name: '移除范围', exact: true }).click();
  await save();
  await page.locator('.settings-savebar').waitFor({ state: 'hidden' });
  assert.notEqual(
    (
      await invoke('local_file_read', {
        rootId: roots[0].id,
        path: '/api-read-fixture.txt',
      })
    ).status,
    200,
  );
  await openSettings();
  await panel.getByLabel('在本机启用 MCP').uncheck();
  await save();
  await page.locator('.settings-savebar').waitFor({ state: 'hidden' });
  await openSettings();
  assert.equal(await panel.getByLabel('在本机启用 MCP').isChecked(), false);
  await panel.getByText('MCP 已停止', { exact: true }).waitFor();
  await page
    .locator('.editor-page:visible')
    .getByRole('button', { name: '取消', exact: true })
    .click();
  console.log(
    'PASS: desktop MCP settings, port binding, token clipboard, actual protocol handshake and service shutdown',
  );
}
