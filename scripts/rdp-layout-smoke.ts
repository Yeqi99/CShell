import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
const data = await mkdtemp(join(tmpdir(), 'cshell-rdp-layout-'));
const env = { ...process.env, CSHELL_TEST_DATA: data };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.'], env });
await mkdir('test-results', { recursive: true });
try {
  const page = await app.firstWindow();
  await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
  await page.evaluate(async () => {
    await window.cshell.pluginInstall('cshell.http');
    await window.cshell.pluginToggle('cshell.http', true);
  });
  await page.reload();
  await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
  // A stalled shell/environment probe must never delay the protocol chooser.
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('local-terminal:environment');
    ipcMain.handle('local-terminal:environment', () => new Promise(() => {}));
  });
  await page.getByRole('button', { name: '新建连接', exact: true }).first().click();
  await page
    .getByRole('button', { name: 'Windows 远程桌面', exact: true })
    .waitFor({ timeout: 1000 });
  const styles = [];
  for (const name of ['SSH 终端', 'CAgent', 'Windows 远程桌面', 'HTTP 请求']) {
    await page.getByRole('button', { name, exact: true }).click();
    const entry = page.locator('.connection-detail:visible');
    if(name==='CAgent'){
      const password=entry.getByLabel('连接密码',{exact:true});
      await password.fill('123456');assert.equal(await password.evaluate((el:HTMLInputElement)=>el.checkValidity()),true);
      await password.fill('1');assert.equal(await password.evaluate((el:HTMLInputElement)=>el.checkValidity()),true);
      await password.fill('');assert.equal(await password.evaluate((el:HTMLInputElement)=>el.checkValidity()),false);
    }
    const trigger = entry.getByRole('button', { name: '从文本填写', exact: true });
    assert.equal(await trigger.count(), 1);
    assert.equal(await entry.getByRole('button', { name: '粘贴连接信息', exact: true }).count(), 0);
    styles.push(
      await trigger.evaluate((el) => {
        const s = getComputedStyle(el);
        return [s.height, s.padding, s.borderRadius, s.backgroundColor, s.fontSize];
      }),
    );
    await trigger.click();
    await entry.getByRole('button', { name: '粘贴文本', exact: true }).waitFor();
    await entry.getByRole('button', { name: '关闭提取', exact: true }).click();
    await page.getByRole('button', { name: '返回连接方式' }).click();
  }
  assert.deepEqual(styles[0], styles[1]);
  assert.deepEqual(styles[1], styles[2]);
  assert.deepEqual(styles[2], styles[3]);
  await page.getByRole('button', { name: 'Windows 远程桌面', exact: true }).click();
  const form = page.locator('.rdp-connection:visible');
  assert.equal(
    await page.getByRole('heading', { name: 'Windows 远程桌面', exact: true }).count(),
    1,
  );
  await form.getByLabel('主机地址', { exact: true }).fill('rdp.example.test');
  await form.getByLabel('账号', { exact: true }).fill('tester');
  await form.getByLabel('密码', { exact: true }).fill('fixture-only');
  await page.getByRole('button', { name: '返回连接方式' }).click();
  await page.getByRole('button', { name: 'SSH 终端', exact: true }).click();
  await page.getByRole('button', { name: '返回连接方式' }).click();
  await page.getByRole('button', { name: 'Windows 远程桌面', exact: true }).click();
  assert.equal(await form.getByLabel('主机地址', { exact: true }).inputValue(), 'rdp.example.test');
  const check = async () => {
    const result = await form.evaluate((el) => {
      const labels = [...el.querySelectorAll('fieldset label')].filter(
        (x) => x.getBoundingClientRect().height > 0 && !x.classList.contains('rdp-checkbox'),
      );
      return {
        overflow: el.scrollWidth > el.clientWidth + 1,
        stacked: labels.every((l) => {
          const input = l.querySelector('input')!;
          return input.getBoundingClientRect().top > l.getBoundingClientRect().top + 15;
        }),
        button: getComputedStyle(el.querySelector('button.primary')!).backgroundColor,
      };
    });
    assert.equal(result.overflow, false);
    assert.equal(result.stacked, true);
    return result;
  };
  await check();
  await page.screenshot({ path: 'test-results/rdp-layout-wide.png' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 760));
  await page.waitForTimeout(250);
  await check();
  await page.screenshot({ path: 'test-results/rdp-layout-narrow.png' });
  await form.getByRole('button', { name: '保存', exact: true }).click();
  await form.getByRole('status').filter({ hasText: '已保存到左侧连接列表' }).waitFor();
  const config = await page.evaluate(() => window.cshell.config());
  assert.equal(config.profiles.find((p) => p.host === 'rdp.example.test')?.protocol, 'rdp');
  await writeFile(
    'test-results/rdp-layout-smoke.json',
    JSON.stringify(
      {
        passed: true,
        immediatePlatformChoice: true,
        delayedEnvironmentIgnored: true,
        draftPreserved: true,
        saved: true,
        wideAndNarrow: true,
      },
      null,
      2,
    ),
  );
} finally {
  await app.close();
}
