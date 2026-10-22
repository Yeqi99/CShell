import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
async function main() {
  const directory = await mkdtemp(join(tmpdir(), 'cshell-drag-test-'));
  const env = { ...process.env, CSHELL_TEST_DATA: directory }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.'], env });
  try {
    console.log('launched'); const page = await app.firstWindow(); page.setDefaultTimeout(15000);
    await page.getByTitle('偏好设置', { exact: true }).waitFor();
    console.log('window ready'); await page.evaluate(async () => {
      for (const name of ['A', 'B', 'C']) await window.cshell.saveProfile({ id: crypto.randomUUID(), name, host: name + '.example', port: 22, username: 'root', auth: 'password', group: '开发', favorite: false });
      await window.cshell.manageGroup({ type: 'create', name: '生产' });
    });
    console.log('before reload'); await page.reload({timeout:10000, waitUntil:'domcontentloaded'}); console.log('reloaded');
    const row = (name: string) => page.locator('[data-group="开发"] .server-item').filter({ has: page.getByText(name, { exact: true }) });
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    await row('C').dispatchEvent('dragstart', { dataTransfer });
    await row('A').dispatchEvent('dragover', { dataTransfer });
    await row('A').dispatchEvent('drop', { dataTransfer });
    await row('C').dispatchEvent('dragend', { dataTransfer });
    await page.waitForFunction(async () => (await window.cshell.config()).profiles[0].name === 'C', undefined, {timeout:10000});
    await row('A').dispatchEvent('dragstart', { dataTransfer });
    await page.locator('[data-group="生产"]').dispatchEvent('dragover', { dataTransfer });
    await page.locator('[data-group="生产"]').dispatchEvent('drop', { dataTransfer });
    await page.waitForFunction(async () => (await window.cshell.config()).profiles.find(p => p.name === 'A')?.group === '生产', undefined, {timeout:10000});
    const before = await page.evaluate(async () => JSON.stringify((await window.cshell.config()).profiles));
    await row('B').dispatchEvent('dragstart', { dataTransfer });
    await row('B').dispatchEvent('dragend', { dataTransfer });
    assert.equal(await page.evaluate(async () => JSON.stringify((await window.cshell.config()).profiles)), before);
    console.log('before reload'); await page.reload({timeout:10000, waitUntil:'domcontentloaded'}); console.log('reloaded');
    await page.locator('[data-group="生产"] .server-item').waitFor();
    assert.equal(await page.locator('[data-group="开发"] .group-name').evaluate(e => getComputedStyle(e).fontSize), '16px');
    await mkdir('test-results', { recursive: true }); await page.screenshot({ path: 'test-results/sidebar-drag.png' });
    console.log('PASS: reorder, cross-group drop, cancelled drag unchanged, persisted reload and 16px group title');
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await app.close().catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });


