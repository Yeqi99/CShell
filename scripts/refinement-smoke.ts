import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { fixture } from '../tests/fixture';

const data = await mkdtemp(join(tmpdir(), 'cshell-refinement-'));
const source = join(data, 'source'),
  target = join(data, 'target');
await mkdir(source);
await mkdir(target);
await writeFile(join(source, 'copy-me.txt'), 'preserved');
await writeFile(join(source, 'move-me.txt'), 'moved');
const server = await fixture();
const env = { ...process.env, CSHELL_TEST_DATA: data };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.'], env });
try {
  const page = await app.firstWindow();
  await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
  await app.evaluate(({ dialog }, path) => {
    (globalThis as any).__name = Object;
    (globalThis as any).movePrompts = 0;
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as any;
    dialog.showMessageBox = (async (_window: unknown, options: any) => {
      if (options.message.includes('移动')) (globalThis as any).movePrompts++;
      return { response: 1, checkboxChecked: false };
    }) as any;
  }, source);
  // Local files belong to the terminal work surface, not the new home page.
  await page.getByLabel('新建本机终端', { exact: true }).click();
  await page.getByRole('menuitem', { name: 'CMD', exact: true }).click();
  await page.locator('.session-tab').filter({ hasText: 'CMD' }).waitFor();
  await page.getByRole('button', { name: '本地文件', exact: true }).click();
  await page.getByRole('button', { name: '选择目录', exact: true }).click();
  const panes = page.locator('.local-directory-pane');
  await panes.first().getByText('copy-me.txt', { exact: true }).waitFor();
  await panes
    .first()
    .getByText('move-me.txt', { exact: true })
    .dragTo(panes.first().locator('.file-toolbar'));
  assert.equal(await app.evaluate(() => (globalThis as any).movePrompts), 0);
  assert.equal(await readFile(join(source, 'move-me.txt'), 'utf8'), 'moved');
  // Same native directory through another grant must also be a no-op.
  const grants = await page.evaluate(async () => [
    await window.cshell.chooseLocal(),
    await window.cshell.chooseLocal(),
  ]);
  await page.evaluate(
    async ([a, b]) =>
      window.cshell.transferFiles(
        [{ kind: 'local', root: a!.root, path: '/move-me.txt' }],
        { kind: 'local', root: b!.root, path: '/' },
        true,
      ),
    grants,
  );
  assert.equal(await app.evaluate(() => (globalThis as any).movePrompts), 0);
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as any;
  }, target);
  await page.getByRole('button', { name: '打开另一个目录', exact: true }).click();
  await panes.nth(1).locator('.file-list').waitFor();
  await panes.first().getByText('copy-me.txt', { exact: true }).click();
  await page.keyboard.press('Control+c');
  await panes.nth(1).locator('.file-list').focus();
  await page.keyboard.press('Control+v');
  await panes.nth(1).getByText('copy-me.txt', { exact: true }).waitFor();
  assert.equal(await readFile(join(target, 'copy-me.txt'), 'utf8'), 'preserved');
  await panes
    .first()
    .getByText('move-me.txt', { exact: true })
    .dragTo(panes.nth(1).locator('.file-toolbar'));
  await panes.nth(1).getByText('move-me.txt', { exact: true }).waitFor();
  assert.equal(await app.evaluate(() => (globalThis as any).movePrompts), 1);
  await assert.rejects(readFile(join(source, 'move-me.txt')), /ENOENT/);
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/local-multiple-directories.png' });
  await page
    .locator('.local-dock > header')
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  // Plugin-owned views are reached from installed plugins, never permanent generic navigation.
  await page.evaluate(() => window.dispatchEvent(new Event('cshell:open-extensions')));
  await page
    .locator('.extension-nav')
    .getByRole('button', { name: '插件市场', exact: true })
    .waitFor();
  assert.equal(await page.locator('.extension-nav button').count(), 2);
  const plugin = page
    .locator('.plugin-row')
    .filter({ has: page.getByRole('heading', { name: /Anaconda/ }) });
  await plugin.getByRole('button', { name: '安装', exact: true }).click();
  await plugin.getByRole('button', { name: '打开插件', exact: true }).click();
  await page.getByRole('heading', { name: 'Anaconda 环境', exact: true }).waitFor();
  await page.locator('.plugin-back').click();
  await plugin.getByRole('button', { name: '停用', exact: true }).click();
  await plugin.getByRole('button', { name: '启用', exact: true }).waitFor();
  assert.equal(await plugin.getByRole('button', { name: '打开插件', exact: true }).count(), 0);
  await page.evaluate(() => window.dispatchEvent(new Event('cshell:open-ai')));
  await page.getByRole('button', { name: '基座与权限', exact: true }).click();
  await page.getByRole('button', { name: '添加基座', exact: true }).click();
  await page.locator('.ai-provider-form').waitFor();
  const height = await page
    .locator('.ai-provider-form input')
    .first()
    .evaluate((el) => el.getBoundingClientRect().height);
  assert.ok(height <= 34);
  await page.getByLabel('名称', { exact: true }).fill('Local UI fixture');
  await page.getByLabel('API URL', { exact: true }).fill('http://127.0.0.1:9/v1');
  await page.getByLabel('模型 ID', { exact: true }).fill('fixture');
  await page.getByRole('button', { name: '保存基座', exact: true }).click();
  await page.getByRole('button', { name: '访问权限', exact: true }).click();
  await page.getByLabel('默认：资源监控', { exact: true }).waitFor();
  await page.getByRole('button', { name: '保存权限', exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/ai-settings-refined.png' });
  await page.getByRole('button', { name: '折叠智能体' }).click();
  await page.getByRole('button', { name: '新建连接', exact: true }).first().click();
  if (await page.getByRole('button', { name: 'SSH 终端', exact: true }).isVisible())
    await page.getByRole('button', { name: 'SSH 终端', exact: true }).click();
  const form = page.locator('.connection-editor:visible');
  await form.getByLabel('保存到服务器列表').uncheck();
  await form.getByLabel('主机地址').fill('127.0.0.1');
  await form.getByLabel('端口').fill(String(server.port));
  await form.getByLabel('用户名').fill('tester');
  await form.locator('.connection-secret input').fill(server.password);
  await form.getByRole('button', { name: '连接', exact: true }).click();
  await page.locator('.terminals:visible .xterm-helper-textarea:visible').waitFor();
  assert.equal(await page.locator('.linux-desktop:visible').count(),0);
  assert.equal((await page.evaluate(()=>window.cshell.config())).preferences.defaultConnectionView,'original');
  const shellCount=server.shellRequests();await page.getByLabel('桌面与显示方式',{exact:true}).click();await page.getByRole('menuitem',{name:'CShell 可视化桌面',exact:true}).click();
  await page.locator('.linux-desktop:visible .desktop-icons').getByRole('button',{name:'文件',exact:true}).dblclick();
  assert.equal(server.shellRequests(),shellCount);
  await page.locator('.metric-cpu strong').getByText('10%', { exact: true }).waitFor();
  const before = await page.locator('.compact-monitor').boundingBox();
  await page.locator('.compact-monitor > header').getByRole('button', { name: '重试' }).click();
  const after = await page.locator('.compact-monitor').boundingBox();
  assert.equal(after!.height, before!.height);
  const categories = page.getByRole('group', { name: '机器信息分类', exact: true });
  assert.equal(
    await page.locator('.metric-cpu .resource-detail').getAttribute('title'),
    'Test CPU Model',
  );
  await categories.getByRole('button', { name: 'GPU', exact: true }).click();
  await page.locator('.gpu-device').getByText('NVIDIA Test GPU', { exact: true }).waitFor();
  assert.equal(await page.locator('.metric-cpu').isVisible(), false);
  await categories.getByRole('button', { name: '进程', exact: true }).click();
  await page.locator('.process-table-scroll').getByText('python3', { exact: true }).waitFor();
  assert.equal(await page.locator('.gpu-inventory').isVisible(), false);
  assert.equal(await page.getByLabel('进程刷新间隔').inputValue(), '0');
  await page.getByLabel('进程刷新间隔').selectOption('15');
  await categories.getByRole('button', { name: 'CPU', exact: true }).click();
  assert.equal(await page.getByLabel('进程刷新间隔').isVisible(), false);
  await categories.getByRole('button', { name: '进程', exact: true }).click();
  assert.equal(await page.getByLabel('进程刷新间隔').inputValue(), '15');
  await page.screenshot({ path: 'test-results/resources-refined.png' });
  // Test global layout on the workbench, outside the machine's app window layer.
  await page.locator('.welcome-tab button').focus();
  await page.locator('.welcome-tab button').click();
  // Live native drag preview describes source and insertion order; Escape cancels it.
  const grip = page.locator('[data-panel="servers"] .dock-grip');
  const g = (await grip.boundingBox())!,
    term = (await page.locator('[data-panel="terminal"]').boundingBox())!;
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + 30, g.y + 10, { steps: 4 });
  await page.mouse.move(term.x + term.width - 15, term.y + 150, { steps: 12 });
  await page.locator('.dock-drop-summary').waitFor();
  await page.screenshot({ path: 'test-results/dock-drop-preview.png' });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.locator('.dock-drop-summary').waitFor({ state: 'hidden' });
  console.log(
    'PASS: same-directory no-op across grants; concurrent panes copy/move; plugin-owned navigation; compact AI settings; stable refresh; process preference; native drag preview and cancellation',
  );
} finally {
  await app.close();
  await server.close();
  await rm(data, { recursive: true, force: true });
}
