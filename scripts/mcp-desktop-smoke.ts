import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import type { ElectronApplication, Page } from 'playwright';
export async function mcpDesktopSmoke(app: ElectronApplication, page: Page) {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  await page.locator('.topbar button').last().click();
  const panel = page.locator('.mcp-settings');
  await panel.getByLabel('在本机启用 MCP').check();
  await panel.getByLabel('端口', { exact: true }).fill(String(port));
  await panel.getByRole('button', { name: '应用 MCP 设置', exact: true }).click();
  await panel.getByText('MCP 正在运行', { exact: true }).waitFor();
  await panel.getByRole('button', { name: '复制访问令牌', exact: true }).click();
  await panel.getByRole('button', { name: '已复制', exact: true }).waitFor();
  const token = await app.evaluate(({ clipboard }) => clipboard.readText());
  assert.ok(token.length > 32);
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
  await panel.screenshot({ path: 'test-results/mcp-settings.png' });
  await panel.getByLabel('在本机启用 MCP').uncheck();
  await panel.getByRole('button', { name: '应用 MCP 设置', exact: true }).click();
  await panel.getByText('MCP 已停止', { exact: true }).waitFor();
  await page
    .locator('.editor-page:visible')
    .getByRole('button', { name: '取消', exact: true })
    .click();
  console.log(
    'PASS: desktop MCP settings, port binding, token clipboard, actual protocol handshake and service shutdown',
  );
}
