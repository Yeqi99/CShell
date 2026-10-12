import { _electron as electron } from 'playwright';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture } from '../tests/fixture';
const remote = await fixture();
let useTools = false;
const data = await mkdtemp(join(tmpdir(), 'cshell-agent-ui-'));
const api = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const last = JSON.parse(body).messages.at(-1);
  res.setHeader('Content-Type', 'application/json');
  res.end(
    JSON.stringify({
      choices: [
        {
          message:
            useTools && last.role !== 'tool'
              ? {
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    {
                      id: randomUUID(),
                      type: 'function',
                      function: {
                        name: 'execute_command',
                        arguments: JSON.stringify({ command: 'pwd' }),
                      },
                    },
                  ],
                }
              : {
                  role: 'assistant',
                  content:
                    '目前有 **1 个连接目标**。\n\n| 名称 | 主机 | 端口 | 用户 | 会话状态 |\n| --- | --- | --- | --- | --- |\n| 测试服务器 | 127.0.0.1 | 22 | tester | 已激活（1 个活动会话） |\n\n- 查看当前目录\n- 只读取当前路径\n\n```sh\npwd\n```',
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
  await mkdir('test-results', { recursive: true });
  const page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByRole('heading', { name: '尚未连接' }).waitFor({ timeout: 60000 });
  assert.equal(await page.getByRole('button', { name: '新建连接', exact: true }).count(), 1);
  assert.equal(await page.locator('.empty-terminal button').count(), 0);
  await page.keyboard.press('Control+Shift+B');
  await page.locator('.sidebar').waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('button', { name: '新建连接', exact: true }).count(), 1);
  await page.keyboard.press('Control+Shift+B');

  await page.locator('.sidebar').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'AI 智能体', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'AI 智能体' });
  assert.equal(await panel.locator('.agent-context select').count(), 0);
  await panel.getByText('CShell · 未绑定机器', { exact: true }).waitFor();

  await panel.getByRole('heading', { name: '连接你的 AI' }).waitFor();
  await page.screenshot({ path: 'test-results/agent-empty.png' });
  await panel.getByRole('button', { name: '配置基座', exact: true }).click();
  await panel.getByRole('button', { name: '添加基座', exact: true }).click();
  await panel.getByLabel('名称', { exact: true }).fill('MiMo Token Plan · 超长基座名称布局验证');
  await panel
    .getByLabel('API URL', { exact: false })
    .fill(`http://127.0.0.1:${(api.address() as any).port}/v1`);
  await panel.getByLabel('模型 ID', { exact: true }).fill('test');
  await panel.getByRole('button', { name: '测试连通性', exact: true }).click();
  await panel.getByRole('status').filter({ hasText: '连接成功' }).waitFor();
  assert.equal((await page.evaluate(() => window.cshell.aiSnapshot())).providers.length, 0);
  await panel.getByRole('button', { name: '保存基座', exact: true }).click();
  await panel.getByText('test · 无 Key', { exact: true }).waitFor();
  await panel.locator('.ai-provider > button').first().click();
  await panel.getByRole('button', { name: '访问权限', exact: true }).click();
  assert.equal(await panel.getByLabel('模型 ID').isVisible(), false);
  await panel.getByLabel('默认：资源监控', { exact: true }).check();
  await panel.getByLabel('默认：读取文件', { exact: true }).check();
  await panel.getByRole('button', { name: '保存权限', exact: true }).click();
  await panel.getByText('权限已保存，所有会话立即生效', { exact: true }).waitFor();
  const savedPermissions = await page.evaluate(() => window.cshell.aiSnapshot());
  assert.ok(savedPermissions.policy.capabilities.includes('metrics.read'));
  assert.ok(savedPermissions.policy.capabilities.includes('files.read'));
  await page.screenshot({ path: 'test-results/agent-permission-tree.png' });
  await panel.getByRole('button', { name: '模型基座', exact: true }).click();
  assert.equal(await panel.getByLabel('模型 ID').inputValue(), 'test');
  await page.screenshot({ path: 'test-results/agent-settings.png' });
  await panel.getByRole('button', { name: '保存基座', exact: true }).click();
  await panel.getByText('test · 无 Key', { exact: true }).waitFor();
  await panel.getByRole('button', { name: '基座与权限', exact: true }).click();
  await panel.getByRole('heading', { name: '从一个任务开始' }).waitFor();
  await page.screenshot({ path: 'test-results/agent-model-picker.png' });
  assert.equal(
    await panel.locator('.agent-composer-tools').evaluate((el) => el.scrollWidth > el.clientWidth),
    false,
  );
  await panel.getByLabel('发送给智能体').fill('查看当前目录');
  await panel.getByLabel('发送给智能体').press('Enter');
  await panel.locator('.agent-code pre').waitFor();
  assert.equal(await panel.locator('.agent-code pre').innerText(), 'pwd');
  assert.equal(await panel.locator('.agent-markdown strong').innerText(), '1 个连接目标');
  assert.equal(await panel.locator('.agent-markdown th').count(), 5);
  assert.equal(await panel.locator('.agent-markdown td').count(), 5);
  assert.equal(await panel.locator('.agent-markdown li').count(), 2);
  await panel.locator('.agent-code').getByRole('button', { name: '复制内容' }).click();
  await panel.locator('.agent-code').getByTitle('已复制').waitFor();
  assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), 'pwd');
  assert.equal(await panel.evaluate((el) => el.scrollWidth > el.clientWidth), false);
  await panel.getByLabel('发送给智能体').fill('这段草稿要保留');
  await panel.getByRole('button', { name: '新建 AI 会话' }).click();
  assert.equal(await panel.getByLabel('发送给智能体').inputValue(), '');
  await panel.getByRole('button', { name: '会话记录', exact: true }).click();
  await panel.locator('.agent-history-row > button').first().click();
  assert.equal(await panel.getByLabel('发送给智能体').inputValue(), '这段草稿要保留');
  await panel.getByLabel('发送给智能体').press('Shift+Enter');
  assert.match(await panel.getByLabel('发送给智能体').inputValue(), /\n/);
  await page.screenshot({ path: 'test-results/agent-chat-light.png' });
  await page.locator('.theme-toggle').click();
  await page.mouse.move(600, 300);
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'test-results/agent-chat-dark.png' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(920, 650));
  await page.screenshot({ path: 'test-results/agent-narrow.png' });
  assert.equal(await panel.evaluate((el) => el.scrollWidth > el.clientWidth), false);
  await app.evaluate(({ BrowserWindow, dialog }) => {
    BrowserWindow.getAllWindows()[0].setSize(1150, 680);
    dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as any;
  });
  const profile = {
    id: randomUUID(),
    name: 'UI test server',
    host: '127.0.0.1',
    port: remote.port,
    username: 'tester',
    auth: 'password' as const,
    group: '',
    favorite: false,
  };
  const toolThread = await page.evaluate(
    async ({ profile, password }) => {
      await window.cshell.saveProfile(profile);
      const { sessionId } = await window.cshell.connect(profile.id, { password, remember: false });
      const providerId = (await window.cshell.aiSnapshot()).providers[0].id;
      await window.cshell.aiPermissionSave({
        location: 'terminal',
        providerId,
        profiles: [profile.id],
        groups: [],
        capabilities: ['commands.execute'],
      });
      return window.cshell.aiThreadCreate('terminal', providerId, 'review', sessionId);
    },
    { profile, password: remote.password },
  );
  useTools = true;
  await page.evaluate((id) => window.cshell.aiSend(id, '测试授权流程'), toolThread.id);
  await panel.getByRole('button', { name: '会话记录', exact: true }).click();
  await panel.getByRole('button').filter({ hasText: '测试授权流程' }).click();
  await panel.getByRole('button', { name: '允许本次', exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/agent-approval.png' });
  await panel.getByRole('button', { name: '拒绝', exact: true }).click();
  await page.waitForFunction(
    (id) =>
      window.cshell.aiSnapshot().then((s) => s.threads.find((t) => t.id === id)?.state === 'idle'),
    toolThread.id,
  );
  await panel.getByLabel('发送给智能体').fill('再次查看目录');
  await panel.getByRole('button', { name: '发送', exact: true }).click();
  await panel.getByRole('button', { name: '允许本次', exact: true }).click();
  await page.waitForFunction(
    (id) =>
      window.cshell.aiSnapshot().then((s) => s.threads.find((t) => t.id === id)?.state === 'idle'),
    toolThread.id,
  );
  await panel.getByLabel('发送给智能体').fill('停止等待授权的任务');
  await panel.getByRole('button', { name: '发送', exact: true }).click();
  await panel.getByRole('button', { name: '允许本次', exact: true }).waitFor();
  await panel.getByRole('button', { name: '停止 AI', exact: true }).click();
  await panel.getByRole('button', { name: '允许本次', exact: true }).waitFor({ state: 'hidden' });
  assert.deepEqual(errors, []);
  await panel.getByRole('button', { name: '基座与权限', exact: true }).click();
  await panel.getByRole('button', { name: '访问权限', exact: true }).click();
  await panel.getByLabel('默认：资源监控', { exact: true }).check();
  await panel.getByRole('button', { name: '基座与权限', exact: true }).click();
  await panel.getByRole('button', { name: '基座与权限', exact: true }).click();
  assert.equal(await panel.getByLabel('默认：资源监控', { exact: true }).isChecked(), true);
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('ai:policy');
    ipcMain.handle('ai:policy', () => {
      throw new Error('Test save failure');
    });
  });
  await panel.getByRole('button', { name: '保存权限', exact: true }).click();
  await panel.getByRole('alert').filter({ hasText: '保存失败' }).waitFor();
  assert.equal(await panel.getByLabel('默认：资源监控', { exact: true }).isChecked(), true);
  console.log(
    'PASS: actual Electron AI configuration, category draft retention, local model response, code rendering, conversation drafts, keyboard send/newline, history, light/dark/narrow',
  );
} finally {
  await app.close();
  await remote.close();
  await new Promise<void>((resolve) => api.close(() => resolve()));
  await rm(data, { recursive: true, force: true });
}
