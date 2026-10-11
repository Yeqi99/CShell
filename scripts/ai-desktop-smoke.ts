import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const data = await mkdtemp(join(tmpdir(), 'cshell-ai-ui-'));
const env = { ...process.env, CSHELL_TEST_DATA: data };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  args: process.env.CSHELL_EXECUTABLE ? [] : ['.'],
  ...(process.env.CSHELL_EXECUTABLE ? { executablePath: process.env.CSHELL_EXECUTABLE } : {}),
  env,
});
try {
  const page = await app.firstWindow();
  await page.getByRole('heading', { name: '尚未连接' }).waitFor();
  const fit = await app.evaluate(({ BrowserWindow, screen }) => {
    const b = BrowserWindow.getAllWindows()[0].getBounds(),
      a = screen.getDisplayMatching(b).workArea;
    return (
      b.x >= a.x && b.y >= a.y && b.x + b.width <= a.x + a.width && b.y + b.height <= a.y + a.height
    );
  });
  assert.equal(fit, true);
  await page.getByRole('button', { name: '极简模式 / Minimal mode' }).click();
  assert.equal(await page.locator('.topbar').isVisible(), false);
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/minimal-mode.png' });
  await page.getByRole('button', { name: '还原工作台 / Restore workbench' }).click();
  assert.equal(await page.locator('.topbar').isVisible(), true);
  await page.getByRole('button', { name: 'AI 智能体', exact: true }).click();
  await page.getByRole('button', { name: '基座与权限', exact: true }).click();
  await page.getByRole('button', { name: '添加基座', exact: true }).click();
  const panel = page.locator('.ai-panel');
  await panel.getByLabel('名称', { exact: true }).fill('Local test');
  await panel.getByLabel('API URL', { exact: true }).fill('http://127.0.0.1:1234/v1');
  await panel.getByLabel('模型 ID', { exact: true }).fill('local');
  await panel.getByLabel('API Key', { exact: true }).fill('test-only-key');
  await panel.getByRole('button', { name: '保存基座', exact: true }).click();
  await panel.getByText('已保存 Key', { exact: false }).waitFor();
  assert.equal((await page.evaluate(() => window.cshell.aiSnapshot())).providers[0].hasKey, true);
  await panel.getByRole('button', { name: '访问权限', exact: true }).click();
  await panel.getByRole('button', { name: '编辑该位置权限' }).click();
  await panel.getByLabel('读取资源指标').check();
  await panel.getByRole('button', { name: '保存权限', exact: true }).click();
  await page.screenshot({ path: 'test-results/ai-settings-light.png' });
  await panel.getByRole('button', { name: '基座与权限', exact: true }).click();
  await panel.getByRole('button', { name: '新建 AI 会话' }).click();
  await panel.getByLabel('审核等级').selectOption('restricted');
  await panel.getByRole('button', { name: '折叠智能体' }).click();
  await page.getByRole('button', { name: 'AI 智能体', exact: true }).click();
  assert.equal(await panel.getByLabel('审核等级').inputValue(), 'restricted');
  await page.screenshot({ path: 'test-results/ai-chat-light.png' });
  console.log(
    'AI settings, permissions, conversation persistence, minimal restore and work-area bounds passed',
  );
} finally {
  await app.close();
  await rm(data, { recursive: true, force: true });
}
