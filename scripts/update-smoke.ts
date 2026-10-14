import { _electron as electron } from 'playwright';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const data = await mkdtemp(join(tmpdir(), 'cshell-update-'));
const env = { ...process.env, CSHELL_TEST_DATA: data };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  ...(process.env.CSHELL_EXECUTABLE
    ? { executablePath: process.env.CSHELL_EXECUTABLE, args: [] }
    : { args: ['.'] }),
  env,
  timeout: 30000,
});
try {
  await app.evaluate(() => {
    (globalThis as any).__name = Object;
  });
  const content = 'harmless update fixture',
    hash = createHash('sha256').update(content).digest('hex');
  await app.evaluate(
    ({ net, shell }, { content, hash }) => {
      (globalThis as any).updateTestMode = 'success';
      shell.openExternal = async (url) => {
        (globalThis as any).openedUpdatePage = url;
      };
      net.fetch = async (input) => {
        const url = String(input);
        const mode = (globalThis as any).updateTestMode;
        if (url.includes('api.github.com')) {
          await new Promise((resolve) => setTimeout(resolve, 600));
          if (mode === 'rate') return new Response('', { status: 403 });
          if (mode === 'none') return new Response('[]');
          return new Response(
            JSON.stringify([
              {
                tag_name: 'v9.9.9',
                draft: false,
                assets: [
                  { name: 'CShell-9.9.9-win-x64.exe', size: content.length },
                  { name: 'SHA256SUMS.txt', size: 100 },
                ].map((a) => ({
                  ...a,
                  browser_download_url:
                    'https://github.com/Yeqi99/CShell/releases/download/v9.9.9/' + a.name,
                })),
              },
            ]),
          );
        }
        if (url.endsWith('SHA256SUMS.txt'))
          return new Response(hash + '  ./CShell-9.9.9-win-x64.exe');
        return mode === 'download-error'
          ? new Response('', { status: 503 })
          : new Response(content);
      };
    },
    { content, hash },
  );
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!window.cshell);
  await page.locator('.topbar button').last().click();
  await page.getByRole('button', { name: '关于与更新', exact: true }).click();
  const panel = page.locator('.update-settings');
  await panel.getByRole('button', { name: '检查更新', exact: true }).click();
  await panel.getByRole('button', { name: '正在检查…', exact: true }).waitFor();
  assert.equal(
    await panel.getByRole('button', { name: '正在检查…', exact: true }).isDisabled(),
    true,
  );
  await panel.getByRole('button', { name: '下载更新', exact: true }).waitFor();
  await app.evaluate(() => {
    (globalThis as any).updateTestMode = 'rate';
  });
  await panel.getByRole('button', { name: '检查更新', exact: true }).click();
  await panel.getByRole('alert').filter({ hasText: 'GitHub 限制了当前网络的请求' }).waitFor();
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/update-rate-limit.png' });
  assert.equal(await panel.getByRole('button', { name: '下载更新', exact: true }).count(), 0);
  await panel.getByRole('button', { name: '打开 GitHub 下载页', exact: true }).click();
  assert.equal(
    await app.evaluate(() => (globalThis as any).openedUpdatePage),
    'https://github.com/Yeqi99/CShell/releases',
  );
  await app.evaluate(() => {
    (globalThis as any).updateTestMode = 'none';
  });
  await panel.getByRole('button', { name: '检查更新', exact: true }).click();
  await panel.getByText('尚未找到适用于此系统的完整安装包', { exact: true }).waitFor();
  await app.evaluate(() => {
    (globalThis as any).updateTestMode = 'success';
  });
  let state = await page.evaluate(() => window.cshell.checkUpdate());
  assert.equal(state.phase, 'available');
  await app.evaluate(() => {
    (globalThis as any).updateTestMode = 'download-error';
  });
  await panel.getByRole('button', { name: '下载更新', exact: true }).click();
  await panel.getByRole('button', { name: '重新下载', exact: true }).waitFor();
  await app.evaluate(() => {
    (globalThis as any).updateTestMode = 'success';
  });
  state = await page.evaluate(() => window.cshell.downloadUpdate());
  assert.equal(state.phase, 'ready');
  await writeFile(join(data, 'updates', 'CShell-9.9.9-win-x64.exe'), 'tampered');
  const error = await page.evaluate(() =>
    window.cshell.installUpdate().then(
      () => '',
      (e) => e.message,
    ),
  );
  assert.match(error, /changed/);
  assert.equal((await page.evaluate(() => window.cshell.updateState())).retry, 'download');
  console.log(
    'PASS: real Electron update IPC, release selection, streamed verified download, tamper rejection before installer',
  );
} catch (e) {
  console.error(e);
  throw e;
} finally {
  await app.close();
  await rm(data, { recursive: true, force: true });
}
