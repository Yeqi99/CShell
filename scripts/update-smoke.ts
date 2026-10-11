import { _electron as electron } from 'playwright';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const data = await mkdtemp(join(tmpdir(), 'cshell-update-'));
const env = { ...process.env, CSHELL_TEST_DATA: data };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.'], env, timeout: 15000 });
try {
  await app.evaluate(() => {
    (globalThis as any).__name = Object;
  });
  const content = 'harmless update fixture',
    hash = createHash('sha256').update(content).digest('hex');
  await app.evaluate(
    (_electron, { content, hash }) => {
      (globalThis as any).fetch = async (url: string) => {
        if (url.includes('api.github.com'))
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
        if (url.endsWith('SHA256SUMS.txt'))
          return new Response(hash + '  ./CShell-9.9.9-win-x64.exe');
        return new Response(content);
      };
    },
    { content, hash },
  );
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!window.cshell);
  let state = await page.evaluate(() => window.cshell.checkUpdate());
  assert.equal(state.phase, 'available');
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
