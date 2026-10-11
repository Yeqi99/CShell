import { _electron as electron } from 'playwright';
import { mkdtemp, rm, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
const data = await mkdtemp(join(tmpdir(), 'cshell-local-'));
const env = { ...process.env, CSHELL_TEST_DATA: data };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  args: process.env.CSHELL_EXECUTABLE ? [] : ['.'],
  ...(process.env.CSHELL_EXECUTABLE ? { executablePath: process.env.CSHELL_EXECUTABLE } : {}),
  env,
});
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  await page.getByRole('heading', { name: '尚未连接' }).waitFor();
  await page.evaluate(() => {
    (window as any).localOutput = {};
    window.cshell.events((e) => {
      if (e.type === 'data')
        (window as any).localOutput[e.sessionId] =
          ((window as any).localOutput[e.sessionId] || '') + e.data;
    });
  });
  await page.evaluate(() =>
    window.cshell.saveLocalEnvironment([{ name: 'CSHELL_LOCAL_TEST', value: '覆盖中文123' }]),
  );
  for (const shell of ['CMD', 'PowerShell']) {
    await page.getByLabel('新建本机终端', { exact: true }).click();
    await page.getByRole('menuitem', { name: shell, exact: true }).click();
    await page.locator('.session-tab').filter({ hasText: shell }).waitFor();
  }
  const ids = await page.evaluate(() => Object.keys((window as any).localOutput));
  assert.equal(ids.length, 2);
  await page.evaluate(
    (id) => window.cshell.input(id, 'echo LOCAL_CMD_%CSHELL_LOCAL_TEST%\r'),
    ids[0],
  );
  await page.evaluate(
    (id) => window.cshell.input(id, 'Write-Output "LOCAL_PS_$env:CSHELL_LOCAL_TEST"\r'),
    ids[1],
  );
  await page.waitForFunction(
    (id) => (window as any).localOutput[id]?.includes('LOCAL_CMD_覆盖中文123'),
    ids[0],
  );
  await page.waitForFunction(
    (id) => (window as any).localOutput[id]?.includes('LOCAL_PS_覆盖中文123'),
    ids[1],
  );
  assert.equal(await page.locator('.monitor-panel:visible').count(), 0);
  await page.evaluate((id) => window.cshell.resize(id, 90, 25), ids[1]);
  await page.evaluate(() =>
    window.cshell.saveLocalEnvironment([{ name: 'CSHELL_LOCAL_TEST', value: 'new-session-only' }]),
  );
  await page.evaluate(
    (id) => window.cshell.input(id, 'Write-Output "STILL_$env:CSHELL_LOCAL_TEST"\r'),
    ids[1],
  );
  await page.waitForFunction(
    (id) => (window as any).localOutput[id]?.includes('STILL_覆盖中文123'),
    ids[1],
  );
  assert.equal(
    (await readFile(join(data, 'local-environment.enc'), 'utf8')).includes('new-session-only'),
    false,
  );
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/local-terminal.png' });
  await page.getByRole('button', { name: '偏好设置', exact: true }).click();
  await page.getByRole('button', { name: '本机终端', exact: true }).click();
  await page.getByLabel('变量名称 1').waitFor();
  assert.equal(await page.getByLabel('变量值 1').inputValue(), 'new-session-only');
  await page.screenshot({ path: 'test-results/local-environment.png' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 600));
  for (let i = 0; i < 5; i++) {
    await page.getByLabel('新建本机终端', { exact: true }).click();
    await page.getByRole('menuitem', { name: 'CMD', exact: true }).click();
  }
  await page.getByRole('button', { name: '查看左侧标签' }).waitFor();
  const geometry = await page.locator('.tabs').evaluate((el) => ({
    y: el.scrollHeight - el.clientHeight,
    style: getComputedStyle(el).scrollbarWidth,
  }));
  assert.ok(geometry.y <= 1);
  assert.equal(geometry.style, 'none');
  await page.getByRole('button', { name: '查看左侧标签' }).click();
  await page.screenshot({ path: 'test-results/tabs-overflow.png' });
  await page.getByRole('button', { name: '插件与应用', exact: true }).click();
  const wsl = page
    .locator('.plugin-row')
    .filter({ has: page.getByRole('heading', { name: /WSL Linux/ }) });
  await wsl.getByRole('button', { name: '安装', exact: true }).click();
  await wsl.getByRole('button', { name: '打开插件', exact: true }).click();
  await page.getByRole('heading', { name: 'Linux 发行版', exact: true }).waitFor();
  const detected = await page.evaluate(() => window.cshell.wslDistributions());
  assert.ok(Array.isArray(detected.distributions));
  await page.screenshot({ path: 'test-results/wsl-plugin.png' });
  console.log(
    'PASS: native CMD/PowerShell, Unicode environment inheritance/override, existing-session isolation, encrypted persistence, no remote monitoring, resize, single-line overflow tabs',
  );
} finally {
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as any;
  });
  await app.close();
  await rm(data, { recursive: true, force: true });
}
