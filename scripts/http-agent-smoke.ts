import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { fixture } from '../tests/fixture';
import { createAgentRuntime } from '../src/agent/runtime';
const directory = await mkdtemp(join(tmpdir(), 'cshell-http-ui-'));
const agentRuntime = await createAgentRuntime({ directory: join(directory, 'agent-service') });
await agentRuntime.startControl();
const env = {
  ...process.env,
  CSHELL_TEST_DATA: directory,
  CSHELL_AGENT_DATA: join(directory, 'agent-service'),
};
delete env.ELECTRON_RUN_AS_NODE;
const api = createServer((req, res) => {
  if (req.url === '/slow') return;
  const chunks: Buffer[] = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        hello: 'HTTP 工作区',
        method: req.method,
        body: Buffer.concat(chunks).toString(),
        path: req.url,
      }),
    );
  });
});
await new Promise<void>((r) => api.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${(api.address() as { port: number }).port}`;
const ssh = await fixture();
const app = await electron.launch({
  ...(process.env.CSHELL_EXECUTABLE
    ? { executablePath: process.env.CSHELL_EXECUTABLE, args: [] }
    : { args: ['.'] }),
  env,
});
try {
  const p = app.context().pages()[0] ?? (await app.context().waitForEvent('page'));
  p.setDefaultTimeout(15000);
  await p.waitForFunction(() => !!window.cshell);
  await mkdir('test-results', { recursive: true });
  await app.evaluate(({ BrowserWindow, dialog }) => {
    (globalThis as any).__name = Object;
    BrowserWindow.getAllWindows()[0].setSize(1360, 860);
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  });
  await p.getByRole('button', { name: '新建连接', exact: true }).first().click();
  assert.equal(await p.getByRole('button', { name: 'HTTP 请求', exact: true }).count(), 0);
  await p.getByRole('button', { name: '插件与应用', exact: true }).click();
  const ext = p.locator('.extension-workbench');
  const httpPlugin = ext
    .locator('.plugin-row')
    .filter({ has: p.getByRole('heading', { name: /^HTTP/ }) });
  await httpPlugin.getByRole('button', { name: '安装', exact: true }).click();
  await httpPlugin.getByRole('button', { name: '停用', exact: true }).waitFor();
  await p.getByRole('button', { name: '新建连接', exact: true }).first().click();
  await p.getByRole('button', { name: 'HTTP 请求', exact: true }).click();
  await p.getByLabel('工作区名称').fill('API 测试');
  await p.getByRole('button', { name: '创建 HTTP 工作区', exact: true }).click();
  const w = p.locator('.http-workbench:visible');
  await w.waitFor();
  await w.getByRole('button', { name: '目标与智能体工具' }).click();
  await w.getByRole('button', { name: '添加目标', exact: true }).click();
  await w.getByLabel('目标名称 1', { exact: true }).fill('本地接口');
  await w.getByLabel('目标地址 1', { exact: true }).fill(url);
  await w.getByRole('button', { name: '添加目标', exact: true }).click();
  await w.getByLabel('目标名称 2', { exact: true }).fill('第二目标');
  await w.getByLabel('目标地址 2', { exact: true }).fill(url + '/v2');
  assert.equal(await w.getByLabel('发送 HTTP 请求', { exact: true }).isChecked(), true);
  await w.getByLabel('查看请求历史与响应', { exact: true }).uncheck();
  await w.getByRole('button', { name: '保存设置', exact: true }).click();
  await w.getByRole('status').filter({ hasText: '设置已保存' }).waitFor();
  await w.getByRole('button', { name: '目标与智能体工具' }).click();
  assert.equal(await w.getByLabel('查看请求历史与响应', { exact: true }).isChecked(), false);
  await w.getByRole('button', { name: '目标与智能体工具' }).click();
  await w.getByLabel('HTTP 目标', { exact: true }).selectOption({ label: `本地接口 · ${url}` });
  await w.getByLabel('请求名称', { exact: true }).fill('中文提交');
  await w.getByLabel('请求方法', { exact: true }).selectOption('POST');
  await w.getByRole('tab', { name: '请求体', exact: true }).click();
  await w.getByLabel('请求体类型', { exact: true }).selectOption('json');
  await w.getByLabel('请求体', { exact: true }).fill('{"hello":"中文 👋"}');
  await w.getByRole('button', { name: '保存请求', exact: true }).click();
  await w.getByRole('status').filter({ hasText: '请求已保存' }).waitFor();
  await w.getByRole('button', { name: '发送', exact: true }).click();
  await w.locator('.http-response pre').filter({ hasText: '中文' }).waitFor();
  assert.equal(
    await w.locator('.http-collections').getByRole('button').filter({ hasText: '200' }).count(),
    1,
  );
  await w.getByLabel('请求体', { exact: true }).fill('{"draft":true}');
  await p.getByRole('button', { name: '插件与应用', exact: true }).click();
  const agentPlugin = ext
    .locator('.plugin-row')
    .filter({ has: p.getByRole('heading', { name: /^CAgent/ }) });
  await agentPlugin.getByRole('button', { name: '安装', exact: true }).click();
  const agent = p.locator('.agent-workbench');
  await agent.waitFor();
  await agent.getByRole('status').filter({ hasText: '远程访问未启动' }).waitFor();
  assert.equal(
    await agent.getByLabel('发送 HTTP 请求（主机）', { exact: true }).isChecked(),
    false,
  );
  await p.screenshot({ path: 'test-results/agent-plugin.png' });
  const free = createServer();
  await new Promise<void>((r) => free.listen(0, '127.0.0.1', r));
  const port = (free.address() as { port: number }).port;
  await new Promise<void>((r) => free.close(() => r()));
  await agent.getByLabel('CMD', { exact: true }).check();
  await agent.getByLabel('连接密码', { exact: true }).fill('cshell-agent-test-password');
  await agent.getByLabel('端口', { exact: true }).fill(String(port));
  await agent.getByLabel('发送 HTTP 请求（主机）', { exact: true }).check();
  await agent.getByRole('button', { name: '保存并启动', exact: true }).click();
  await agent.getByRole('status').filter({ hasText: '远程访问已启动' }).waitFor();
  await p.screenshot({ path: 'test-results/agent-plugin.png' });
  // Connect the separately running Agent using its actual TLS provider.
  const sender = await p.evaluate(
    async ({ port }) => {
      const info = await window.cshell.clientProbe({ host: '127.0.0.1', port });
      const device = await window.cshell.clientPasswordPair(info, 'cshell-agent-test-password');
      const session = await window.cshell.clientConnect(device.deviceId, 'cmd');
      return { id: device.deviceId, sessionId: session.sessionId };
    },
    { port },
  );
  await p.locator('.tab').getByRole('button', { name: 'API 测试', exact: true }).click();
  assert.equal(await w.getByLabel('请求体', { exact: true }).inputValue(), '{"draft":true}');
  await w.getByRole('button', { name: '刷新请求和发送方' }).click();
  await w.getByLabel('HTTP 发送方', { exact: true }).selectOption(sender.id);
  await w.getByRole('button', { name: '发送', exact: true }).click();
  await w.getByRole('status').filter({ hasText: '请求完成' }).waitFor();
  assert.ok(
    (
      await p.evaluate(async () => {
        const cfg = await window.cshell.config();
        return window.cshell.httpHistory(cfg.profiles.find((p) => p.protocol === 'http')!.id);
      })
    )[0].senderLabel !== '本机',
  );
  await w.getByLabel('请求地址', { exact: true }).fill('/slow');
  await w.getByRole('button', { name: '发送', exact: true }).click();
  await w.getByRole('button', { name: '取消', exact: true }).click();
  await w.getByRole('button', { name: '发送', exact: true }).waitFor();
  const session = await p.evaluate(
    async ({ port, password }) => {
      const profile = {
        id: crypto.randomUUID(),
        name: 'SSH 发送方',
        host: '127.0.0.1',
        port,
        username: 'tester',
        auth: 'password' as const,
        group: '',
        favorite: false,
      };
      await window.cshell.saveProfile(profile);
      const result = await window.cshell.connect(profile.id, { password, remember: false });
      return { id: profile.id, sessionId: result.sessionId };
    },
    { port: ssh.port, password: ssh.password },
  );
  await w.getByRole('button', { name: '刷新请求和发送方' }).click();
  await w.getByLabel('HTTP 发送方', { exact: true }).selectOption(session.id);
  await w.getByLabel('HTTP 目标', { exact: true }).selectOption('');
  await w.getByLabel('请求方法', { exact: true }).selectOption('GET');
  await w.getByLabel('请求体类型', { exact: true }).selectOption('none');
  await w.getByLabel('请求地址', { exact: true }).fill('http://127.0.0.1:8888/');
  await w.getByRole('button', { name: '发送', exact: true }).click();
  await w.locator('.http-response pre').filter({ hasText: 'Jupyter' }).waitFor();
  assert.equal(ssh.shellInputs.length, 0);
  await w.getByLabel('请求地址', { exact: true }).fill('/keep-draft');
  await p.screenshot({ path: 'test-results/http-workbench-light.png' });
  await p.getByRole('button', { name: '切换为深色', exact: true }).click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 700));
  await p.screenshot({ path: 'test-results/http-workbench-dark.png' });
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await w.getByLabel('请求地址', { exact: true }).inputValue(), '/keep-draft');
  assert.equal(await p.getByRole('dialog').count(), 0);
  await p.evaluate(
    async ({ a, b }) => {
      await window.cshell.disconnect(a);
      await window.cshell.disconnect(b);
      await window.cshell.clientStop();
    },
    { a: sender.sessionId, b: session.sessionId },
  );
  console.log(
    'HTTP + Agent desktop: install, create, tools opt-out, drafts, local/Agent/SSH send, cancel, theme, narrow window PASS',
  );
} catch (error) {
  const p = app.context().pages()[0];
  if (p) {
    await p.screenshot({ path: 'test-results/http-agent-failed.png' });
    console.log((await p.locator('body').innerText()).slice(-4500));
  }
  throw error;
} finally {
  await app.close();
  await agentRuntime.close();
  await ssh.close();
  api.closeAllConnections();
  await new Promise<void>((r) => api.close(() => r()));
  await rm(directory, { recursive: true, force: true, maxRetries: 5 });
}
