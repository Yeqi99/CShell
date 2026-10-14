import { _electron as electron } from 'playwright';
import { mkdtemp, rm, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';
const data = await mkdtemp(join(tmpdir(), 'cshell-client-ui-'));
await mkdir(join(data, 'client'));
await mkdir(join(data, 'control'));
const environment = (part: string) => {
  const env = { ...process.env, CSHELL_TEST_DATA: join(data, part) };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
};
const server = createServer();
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const port = (server.address() as any).port;
await new Promise<void>((r) => server.close(() => r()));
const client = await electron.launch({
  ...(process.env.CSHELL_CLIENT_EXECUTABLE
    ? {
        executablePath: process.env.CSHELL_CLIENT_EXECUTABLE,
        args: ['--disable-backgrounding-occluded-windows'],
      }
    : { args: ['.', '--client'] }),
  env: environment('client'),
});
const clientWindow = await client.firstWindow();
await clientWindow.locator('.client-service-card').waitFor();
const control = await electron.launch({
  ...(process.env.CSHELL_EXECUTABLE
    ? {
        executablePath: process.env.CSHELL_EXECUTABLE,
        args: ['--disable-backgrounding-occluded-windows'],
      }
    : { args: ['.'] }),
  env: environment('control'),
});
try {
  const c = clientWindow,
    w = await control.firstWindow();
  c.setDefaultTimeout(20000);
  w.setDefaultTimeout(20000);
  await c.locator('.client-service-card').getByText('服务已停止', { exact: true }).waitFor();
  await mkdir('test-results', { recursive: true });
  await c.screenshot({ path: 'test-results/client-idle.png' });
  await c.getByRole('button', { name: '设置', exact: true }).click();
  await c.getByLabel('端口', { exact: true }).fill(String(port));
  const password = 'CShell-Local-Test-2026!';
  await c.getByLabel('连接密码', { exact: true }).fill(password);
  await c.getByLabel('CMD', { exact: true }).check();
  await c.getByLabel('PowerShell', { exact: true }).check();
  await c.getByRole('button', { name: '保存访问设置', exact: true }).click();
  await c.getByRole('button', { name: '启动服务', exact: true }).click();
  await c.getByText('服务运行中', { exact: true }).waitFor();
  await c.getByRole('button', { name: '复制连接信息', exact: true }).click();
  await c.getByRole('button', { name: '已复制', exact: true }).waitFor();
  const invitation = await client.evaluate(({ clipboard }) => clipboard.readText());
  assert.equal(invitation.includes(password), false);
  await c.getByRole('button', { name: '切换深色主题' }).click();
  await c.getByLabel('Language').selectOption('en-US');
  assert.equal(await c.getByLabel('CMD', { exact: true }).isChecked(), true);

  await c.screenshot({ path: 'test-results/client-dark-en.png' });
  await c.getByRole('button', { name: 'Switch to light theme' }).click();
  await c.getByLabel('Language').selectOption('zh-CN');
  await client.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(440, 520));
  assert.equal(
    await c.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
  );
  await c.screenshot({ path: 'test-results/client-narrow.png' });
  await client.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(560, 580));
  await w.getByRole('button', { name: '新建连接', exact: true }).first().click();
  await w.getByRole('button', { name: 'CShell Agent', exact: true }).click();
  await w.locator('.connection-metadata summary').click();
  const clientForm = w.locator('.protocol-form .client-connect-form');
  await clientForm.getByLabel('名称', { exact: true }).fill('Client 本机测试');
  await clientForm.getByLabel('分组', { exact: true }).fill('测试分组');
  await clientForm.getByLabel('收藏', { exact: true }).check();
  await clientForm.getByRole('button', { name: '粘贴连接信息' }).click();
  await clientForm.getByLabel('连接密码', { exact: true }).fill(password);
  await clientForm.getByLabel('我已核对设备身份').check();
  await w.getByRole('button', { name: '返回连接方式' }).click();
  await w.getByRole('button', { name: 'SSH 终端', exact: true }).click();
  await w.getByRole('button', { name: '返回连接方式' }).click();
  await w.getByRole('button', { name: 'CShell Agent', exact: true }).click();
  assert.equal(await clientForm.getByLabel('连接密码', { exact: true }).inputValue(), password);
  await w.screenshot({ path: 'test-results/client-new-connection.png' });
  await clientForm.getByRole('button', { name: '验证并读取终端', exact: true }).click();
  await clientForm.getByLabel('终端', { exact: true }).selectOption('cmd|');
  await clientForm.getByRole('button', { name: '连接', exact: true }).click();
  await w.locator('.session-tab').waitFor();
  // Use the visible xterm input; do not inject through a shell helper.
  const input = w.locator('.xterm-helper-textarea').first();
  await input.focus();
  await input.fill('echo CSHELL_CLIENT_REAL_CONPTY');
  await input.press('Enter');
  await w.waitForFunction(
    () => (document.body.textContent?.match(/CSHELL_CLIENT_REAL_CONPTY/g)?.length ?? 0) >= 2,
  );
  assert.equal(await w.locator('.monitor-panel:visible').count(), 0);
  const row = w.locator('.server-item').filter({ hasText: 'Client 本机测试' }).first();
  await row.locator('.server-open').waitFor();
  assert.equal(await row.locator('.dot.off').count(), 0);
  await row.locator('.favorite-button').click();
  await w.waitForFunction(() => !document.querySelector('.server-item .favorite-button.starred'));
  await row.locator('.server-more').click();
  await w.getByRole('menuitem', { name: /编辑/ }).click();
  const editor = w.locator('.client-profile-editor');
  await editor.getByLabel('名称', { exact: true }).fill('Client 已重命名');
  await editor.getByLabel('分组', { exact: true }).fill('办公电脑');
  await editor.getByLabel('默认终端', { exact: true }).selectOption('powershell|');
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await editor.getByText('已保存', { exact: true }).waitFor();
  await w.locator('.server-open').filter({ hasText: 'Client 已重命名' }).first().dblclick();
  await w.waitForFunction(() => document.querySelectorAll('.session-tab').length === 2);
  const ps = w.locator('.terminal-pane.active .xterm-helper-textarea');
  await ps.focus();
  await ps.fill('Write-Output CSHELL_CLIENT_POWERSHELL');
  await ps.press('Enter');
  await w.waitForFunction(
    () => (document.body.textContent?.match(/CSHELL_CLIENT_POWERSHELL/g)?.length ?? 0) >= 2,
  );
  await mkdir('test-results', { recursive: true });
  await w.screenshot({ path: 'test-results/client-terminal.png' });
  assert.equal(await w.getByRole('button', { name: 'Client 设备', exact: true }).count(), 0);
  const savedProfiles = await w.evaluate(() => window.cshell.config());
  assert.ok(
    savedProfiles.profiles.some(
      (p) =>
        p.protocol === 'client' &&
        p.name === 'Client 已重命名' &&
        p.group === '办公电脑' &&
        !p.favorite,
    ),
  );
  await c.locator('.client-dashboard').evaluate((el) => {
    el.scrollTop = 0;
  });
  await c.bringToFront();
  await c.screenshot({ path: 'test-results/client-service.png' });
  await c.getByRole('button', { name: '设置', exact: true }).click();
  assert.equal(await c.getByLabel('端口', { exact: true }).inputValue(), String(port));
  await c.getByRole('button', { name: '连接', exact: true }).click();

  const encrypted = await readFile(join(data, 'client', 'client', 'identity.enc'), 'utf8');
  assert.ok(!encrypted.includes('PRIVATE KEY'));
  await c.getByRole('button', { name: /已授权控制端/ }).click();
  await c.getByRole('button', { name: '撤销授权并断开' }).click();
  await w.waitForFunction(() => document.querySelectorAll('.session-tab .dot.off').length === 2);
  await c.getByRole('button', { name: '停止服务', exact: true }).click();
  await c.locator('.client-service-card').getByText('服务已停止', { exact: true }).waitFor();
  console.log(
    'PASS: independent Windows Client, explicit shell permission, password connection UI, real ConPTY over mutual TLS, encrypted identity, revocation and shutdown',
  );
} catch (error) {
  console.error('Client smoke failed:', error);
  for (const application of [client, control]) {
    for (const page of application.windows()) {
      console.error(
        await page
          .locator('[role="alert"]')
          .allTextContents()
          .catch(() => []),
      );
    }
  }
  throw error;
} finally {
  await control.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await client.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await control.close();
  await client.close();
  await rm(data, { recursive: true, force: true, maxRetries: 5 });
}
