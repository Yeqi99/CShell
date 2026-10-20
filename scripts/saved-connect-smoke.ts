import { _electron as electron } from 'playwright';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { fixture } from '../tests/fixture';
const data = await mkdtemp(join(tmpdir(), 'cshell-quick-'));
const server = await fixture();
const env = { ...process.env, CSHELL_TEST_DATA: data };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.'], env });
try {
  const page = await app.firstWindow();
  await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as any;
  });
  await page.evaluate(async (profile) => window.cshell.saveProfile(profile), {
    id: randomUUID(),
    name: 'Saved server',
    host: '127.0.0.1',
    port: server.port,
    username: 'tester',
    auth: 'password' as const,
    group: '',
    favorite: false,
  });
  await page.reload();
  const machine = page.locator('.server-open').filter({ hasText: 'Saved server' });
  await machine.dblclick();
  const auth = page.locator('.saved-connection:visible');
  await auth.getByLabel('密码', { exact: true }).fill('wrong');
  assert.equal(await page.locator('.connection-editor:visible').count(), 0);
  assert.equal(await auth.locator('input:not([type=checkbox])').count(), 1);
  await auth.getByRole('button', { name: '连接', exact: true }).click();
  await auth.getByRole('alert').waitFor();
  assert.equal(await page.locator('.toast').count(), 0);
  await auth.getByLabel('密码', { exact: true }).fill(server.password);
  await auth.getByRole('checkbox').check();
  await auth.getByRole('button', { name: '连接', exact: true }).click();
  await auth.waitFor({ state: 'hidden' });
  await page.locator('.session-tab').waitFor();
  await machine.dblclick();
  await page.waitForFunction(() => document.querySelectorAll('.session-tab').length === 2);
  assert.equal(await page.locator('.saved-connection').count(), 0);
  assert.equal(await page.locator('.connection-editor:visible').count(), 0);
  await page.getByRole('button', { name: '连接操作 · Saved server', exact: true }).click();
  await page.getByRole('menuitem', { name: '编辑连接', exact: true }).click();
  await page.locator('.connection-editor:visible').getByLabel('主机地址').waitFor();
  assert.equal(await page.locator('.session-tab').count(), 2);
  console.log(
    'PASS: double-click opens authentication only, inline failure/retry, saved secret connects directly, subsequent double-click creates another session, explicit menu editing retains sessions',
  );
} finally {
  await app.close();
  await server.close();
  await rm(data, { recursive: true, force: true });
}
