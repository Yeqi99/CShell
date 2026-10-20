import { _electron as electron } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { fixture } from '../tests/fixture';
const data = await mkdtemp(join(tmpdir(), 'cshell-ai-work-ui-'));
const ssh = await fixture();
let complete = false;
const modelRequests: { url?: string; goal: boolean; lastRole: string }[] = [];
const tool = (name: string, args: unknown) => ({
  content: null,
  tool_calls: [
    { id: randomUUID(), type: 'function', function: { name, arguments: JSON.stringify(args) } },
  ],
});
const api = createServer(async (req, res) => {
  let raw = '';
  for await (const part of req) raw += part;
  const body = JSON.parse(raw),
    last = body.messages.at(-1);
  modelRequests.push({ url: req.url, goal: body.messages[0].content.includes('Current goal:'), lastRole: last.role });
  let message: any;
  if (body.messages[0].content.includes('Current goal:'))
    message =
      last.role === 'tool'
        ? { content: '本轮检查已记录' }
        : tool('report_goal', {
            status: complete ? 'complete' : 'continue',
            summary: '测试目标检查记录；未执行删除',
          });
  else if (body.messages.find((m: any) => m.role === 'user')?.content === '子任务检查')
    message =
      last.role === 'tool'
        ? { content: '子任务已取得真实命令结果' }
        : tool('execute_command', { command: 'pwd' });
  else if (last.role !== 'tool') message = tool('spawn_agent', { task: '子任务检查' });
  else {
    const result = JSON.parse(last.content);
    message = result.result
      ? { content: '主任务已汇总子任务结果' }
      : tool('wait_agent', { id: result.id });
  }
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ choices: [{ message }] }));
});
await new Promise<void>((r) => api.listen(0, '127.0.0.1', r));
const env = { ...process.env, CSHELL_TEST_DATA: data };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  ...(process.env.CSHELL_EXECUTABLE
    ? {
        executablePath: process.env.CSHELL_EXECUTABLE,
        args: ['--disable-backgrounding-occluded-windows'],
      }
    : { args: ['.', '--disable-backgrounding-occluded-windows'] }),
  env,
});
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as any;
  });
  const profile = {
    id: randomUUID(),
    name: 'Goal test machine',
    host: '127.0.0.1',
    port: ssh.port,
    username: 'tester',
    auth: 'password' as const,
    group: '',
    favorite: false,
  };
  const provider = {
    id: randomUUID(),
    name: 'Work fixture',
    model: 'test',
    url: `http://127.0.0.1:${(api.address() as any).port}/v1`,
  };
  await page.evaluate(
    async ({ profile, provider }) => {
      await window.cshell.saveProfile(profile);
      await window.cshell.aiProviderSave(provider);
      await window.cshell.aiPolicySave({
        application: ['agents.manage', 'goals.manage'],
        allMachines: false,
        profiles: [profile.id],
        groups: [],
        capabilities: ['commands.execute'],
        overrides: [],
      });
    },
    { profile, provider },
  );
  await page.reload();
  await page.locator('.server-open').filter({ hasText: profile.name }).dblclick();
  await page
    .locator('.saved-connection:visible')
    .getByLabel('密码', { exact: true })
    .fill(ssh.password);
  await page
    .locator('.saved-connection:visible')
    .getByRole('button', { name: '连接', exact: true })
    .click();
  await page.locator('.session-tab').waitFor();
  await page.getByRole('button', { name: 'AI 智能体', exact: true }).click();
  const panel = page.locator('.ai-panel');
  await panel.getByLabel('发送给智能体').fill('分配一个子任务');
  await panel.getByLabel('发送给智能体').press('Enter');
  const childButton = panel.locator('.agent-task-tree button').filter({ hasText: '子任务检查' });
  await childButton.waitFor();
  await panel.getByLabel('发送给智能体').fill('主任务草稿');
  await childButton.click();
  await panel.getByText('等待执行授权', { exact: true }).waitFor();
  assert.match(await panel.locator('.agent-approval').innerText(), /Goal test machine/);
  await panel.getByRole('button', { name: '允许本次', exact: true }).click();
  await panel.getByText('子任务已取得真实命令结果', { exact: true }).waitFor();
  await panel.getByRole('button', { name: '返回主任务' }).click();
  await panel.getByText('主任务已汇总子任务结果', { exact: true }).waitFor();
  assert.equal(await panel.getByLabel('发送给智能体').inputValue(), '主任务草稿');
  await panel.getByRole('button', { name: '目标管理' }).click();
  await panel.getByRole('button', { name: '新建目标', exact: true }).click();
  await panel.getByLabel('目标与完成条件').fill('检查测试容器状态，不执行删除');
  assert.equal(await panel.getByLabel('检查间隔（分钟）').inputValue(), '15');
  await panel.getByRole('button', { name: '保存目标' }).click();
  await panel.locator('.agent-goal-card').waitFor();
  await panel.getByRole('button', { name: '立即检查' }).click();
  await panel
    .locator('.agent-goal-card')
    .getByText('测试目标检查记录；未执行删除', { exact: true })
    .first()
    .waitFor();
  await panel.getByRole('button', { name: '暂停', exact: true }).click();
  await panel.getByText('已暂停', { exact: true }).waitFor();
  complete = true;
  await panel.getByRole('button', { name: '立即检查' }).click();
  await panel.getByText('已达成', { exact: true }).waitFor();
  assert.equal(await page.locator('[role="dialog"]:visible').count(), 0);
  assert.equal(await page.locator('.session-tab').count(), 1);
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/ai-goals-light.png' });
  await page.getByRole('button', { name: '切换为深色' }).click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(980, 700));
  await page.screenshot({ path: 'test-results/ai-goals-dark.png' });
  assert.equal(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth), true);
  await panel.getByRole('button', { name: '移除目标并保留会话' }).click();
  await panel.locator('.agent-goal-card').waitFor({ state: 'hidden' });
  console.log(
    'PASS: child execution and approval on pinned SSH target, parent draft retained, goal create/run/pause/complete/remove, light/dark/narrow, no extra modal or lost session',
  );
} catch (error) {
  console.error('Model fixture requests:', JSON.stringify(modelRequests));
  console.error('AI work fixture state:', JSON.stringify(await app.firstWindow().then(page => page.evaluate(() => window.cshell.aiSnapshot())), null, 2));
  throw error;
} finally {
  await app.close();
  await ssh.close();
  api.closeAllConnections();
  await new Promise<void>((r) => api.close(() => r()));
  await rm(data, { recursive: true, force: true, maxRetries: 5 });
}
