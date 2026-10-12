// Opt-in verification against an already initialized local Ubuntu; never installs or modifies it.
import { _electron as electron } from 'playwright';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
const data = await mkdtemp(join(tmpdir(), 'cshell-wsl-desktop-'));
const env = { ...process.env, CSHELL_TEST_DATA: data };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.'], env });
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  await page.getByRole('heading', { name: '尚未连接' }).waitFor();
  const ready = await page.evaluate(async () => {
    await window.cshell.pluginInstall('cshell.wsl');
    const list = await window.cshell.wslDistributions();
    if (!list.distributions.includes('Ubuntu')) return false;
    return (await window.cshell.wslAccountStatus('Ubuntu')).ready;
  });
  assert.ok(ready, 'Requires an already initialized Ubuntu. No user will be created by this test.');
  await page.reload();
  await page.locator('.local-target-row').filter({ hasText: 'Ubuntu' }).dblclick();
  await page.locator('.session-tab').filter({ hasText: 'Ubuntu' }).waitFor();
  const id = await page.locator('.session-tab').getAttribute('data-session');
  await page.evaluate((id) => window.cshell.input(id!, 'printf "CSHELL_WSL_READY\\n"\r'), id);
  await page.waitForFunction(() =>
    document.querySelector('.xterm-screen')?.textContent?.includes('CSHELL_WSL_READY'),
  );
  assert.doesNotMatch(
    await page.locator('.xterm-screen').innerText(),
    /New password:|Create a default Unix user/,
  );
  await page.evaluate((id) => window.cshell.disconnect(id!), id);
  console.log(
    'PASS: actual local Ubuntu discovered in machine list, opened through WSL provider, prompt without first-run password flow',
  );
} finally {
  await app.close();
  await rm(data, { recursive: true, force: true });
}
