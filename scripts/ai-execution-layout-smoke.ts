import { _electron as electron } from 'playwright';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { fixture } from '../tests/fixture';

const data = await mkdtemp(join(tmpdir(), 'cshell-execution-ui-'));
const env = { ...process.env, CSHELL_TEST_DATA: data };
delete env.ELECTRON_RUN_AS_NODE;
const remote = await fixture();
const app = await electron.launch({ args: ['.'], env });
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  await page.getByRole('heading', { name: '尚未连接' }).waitFor();
  await page.getByRole('button', { name: 'AI 智能体', exact: true }).click();
  const slot = page.locator('.ai-panel-slot');
  const before = (await slot.boundingBox())!;
  const handle = (await slot.getByRole('separator').boundingBox())!;
  await page.mouse.move(handle.x + 4, handle.y + 30);
  await page.mouse.down();
  await page.mouse.move(handle.x - 96, handle.y + 30, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(() => window.cshell.config().then((c) => c.preferences.layout.agentWidth > 550));
  assert.ok((await slot.boundingBox())!.width > before.width + 80);
  await slot.getByRole('separator').focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => window.cshell.config().then((c) => c.preferences.layout.agentWidth === 590));
  await page.getByRole('button', { name: '基座与权限', exact: true }).click();
  await slot.getByRole('button', { name: '执行过程', exact: true }).click();
  await slot.getByLabel('显示方式').selectOption('silent');
  await page.waitForFunction(() => window.cshell.config().then((c) => !c.preferences.showAiExecution));
  await page.reload();
  await page.getByRole('heading', { name: '尚未连接' }).waitFor();
  const preferences = await page.evaluate(() => window.cshell.config().then((c) => c.preferences));
  assert.equal(preferences.layout.agentWidth, 590);
  assert.equal(preferences.showAiExecution, false);
  await page.getByRole('button', { name: 'AI 智能体', exact: true }).click();
  await page.getByRole('button', { name: '基座与权限', exact: true }).click();
  await slot.getByRole('button', { name: '执行过程', exact: true }).click();
  assert.equal(await slot.getByLabel('显示方式').inputValue(), 'silent');
  await slot.getByLabel('显示方式').selectOption('visible');
  await page.waitForFunction(() => window.cshell.config().then((c) => c.preferences.showAiExecution));

  await app.evaluate(({ dialog }) => { dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as any; });
  const profile = { id: randomUUID(), name: 'Execution UI fixture', host: '127.0.0.1', port: remote.port, username: 'tester', auth: 'password' as const, group: '', favorite: false };
  const { sessionId } = await page.evaluate(async ({ profile, password }) => {
    await window.cshell.saveProfile(profile);
    return window.cshell.connect(profile.id, { password, remember: false });
  }, { profile, password: remote.password });
  await app.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].webContents.send('ai:connected', value), { sessionId, profile });
  await page.locator('.terminal-pane.active').waitFor();
  const thread = { id: randomUUID(), title: 'fixture', location: 'terminal', providerId: randomUUID(), sessionId, mode: 'allow', messages: [], state: 'running', execution: { id: randomUUID(), sessionId, input: 'printf progress', output: 'progress', state: 'running' } };
  const publish = async (value: typeof thread) => app.evaluate(({ BrowserWindow }, t) => BrowserWindow.getAllWindows()[0].webContents.send('ai:thread', t), value);
  await publish(thread);
  await page.getByRole('region', { name: '智能体执行过程' }).waitFor();
  assert.match(await page.locator('.ai-execution pre').innerText(), /printf progress\nprogress/);
  await publish({ ...thread, execution: { ...thread.execution, id: randomUUID(), sessionId: randomUUID(), output: 'WRONG_TARGET' } });
  assert.doesNotMatch(await page.locator('.ai-execution pre').innerText(), /WRONG_TARGET/);
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/ai-execution-visible.png' });
  await slot.getByLabel('显示方式').selectOption('silent');
  await page.locator('.ai-execution').waitFor({ state: 'hidden' });
  await publish(thread);
  assert.equal(await page.locator('.ai-execution').count(), 0);
  await page.evaluate((id) => window.cshell.disconnect(id), sessionId);
  console.log('PASS: drag/keyboard width; settings persisted on reload; bound-session process display; silent mode suppression');
} finally {
  await app.close();
  await remote.close();
  await rm(data, { recursive: true, force: true });
}

