import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const server = createServer(async (req, res) => {
  const path = req.url === '/' ? 'index.html' : req.url!.slice(1);
  if (!['index.html', 'app.js', 'app.css'].includes(path)) {
    res.writeHead(404).end();
    return;
  }
  res.setHeader(
    'Content-Type',
    path.endsWith('.js')
      ? 'application/javascript'
      : path.endsWith('.css')
        ? 'text/css'
        : 'text/html',
  );
  res.end(await readFile('android/app/src/main/assets/' + path));
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript('window.__name = (fn) => fn');
  await page.addInitScript(() => {
    const calls: any[] = [];
    (window as any).nativeCalls = calls;
    (window as any).CShellNative = {
      version: () => '0.3.2',
      connect: (data: string) => {
        const p = JSON.parse(data);
        calls.push(p);
        setTimeout(() => {
          (window as any).receive(p.id, 'connected', '');
          (window as any).receive(p.id, 'data', btoa('test-session$ '));
        }, 50);
      },
      input: (...args: any[]) => calls.push(args),
      resize: () => {},
      acknowledge: () => {},
      disconnect: () => {},
      checkUpdate: () => {
        (window as any).updateEvent(
          JSON.stringify({ message: '当前已是最新可用版本', busy: false }),
        );
      },
      installUpdate: () => {},
    };
  });
  await page.goto('http://127.0.0.1:' + (server.address() as any).port);
  await mkdir('test-results', { recursive: true });
  assert.equal(await page.locator('#connect').isVisible(), false);
  await page.screenshot({ path: 'test-results/android-home.png' });
  await page.locator('#empty-new').click();
  assert.equal(await page.locator('#connect-actions').isVisible(), true);
  await page.locator('[name=host]').fill('test.example');
  await page.locator('[name=name]').fill('测试连接');
  await page.locator('[name=group]').fill('开发');
  await page.locator('[name=password]').fill('secret-not-persisted');
  await page.locator('#back').click();
  await page.locator('#new').click();
  assert.equal(await page.locator('[name=host]').inputValue(), 'test.example');
  await page.screenshot({ path: 'test-results/android-connection.png' });
  await page.locator('#save').click();
  assert.equal(await page.locator('.server-open').count(), 1);
  assert.ok(
    !(await page.evaluate(() => localStorage.getItem('profiles')))?.includes(
      'secret-not-persisted',
    ),
  );
  await page.screenshot({ path: 'test-results/android-servers.png' });
  await page.locator('.server-open').click();
  await page.locator('[name=password]').fill('secret');
  await page.locator('button[type=submit]').click();
  try {
    await page.waitForFunction(
      () => document.getElementById('status')?.textContent === '已连接',
      undefined,
      { timeout: 5000 },
    );
  } catch (e) {
    console.log(
      errors,
      await page.evaluate(() => ({
        calls: (window as any).nativeCalls,
        error: document.getElementById('form-error')?.textContent,
        status: document.getElementById('status')?.textContent,
      })),
    );
    throw e;
  }
  await page.locator('#minimal').click();
  assert.equal(await page.locator('#navigation').isVisible(), false);
  await page.getByRole('button', { name: '还原工作台' }).click();
  await page.locator('[data-page=home]').click();
  await page.locator('[data-page=session-page]').click();
  await page.locator('#session-list .server-open').click();
  assert.equal(await page.locator('#terminals > .terminal').count(), 1);
  assert.ok(await page.locator('.xterm-screen').isVisible());
  await page.setViewportSize({ width: 320, height: 480 });
  assert.equal(await page.evaluate(() => document.body.scrollWidth <= window.innerWidth), true);
  await page.setViewportSize({ width: 852, height: 393 });
  assert.equal(await page.locator('#minimal').isVisible(), true);
  await page.locator('[data-page=settings]').click();
  await page.locator('#theme').click();
  await page.locator('#check-update').click();
  assert.equal(await page.locator('#update-status').innerText(), '当前已是最新可用版本');
  await page.setViewportSize({ width: 393, height: 852 });
  await page.screenshot({ path: 'test-results/android-settings-dark.png' });
  await page.reload();
  await page.locator('#home').waitFor();
  assert.equal(await page.locator('.server-open').count(), 1);
  assert.equal(await page.locator('body.dark').count(), 1);
  assert.deepEqual(errors, []);
  console.log(
    'Android web workbench: navigation, persistence, drafts, sessions, minimal mode, narrow/landscape, update feedback passed. Native SSH/installer require device validation.',
  );
} finally {
  await browser.close();
  server.close();
}
