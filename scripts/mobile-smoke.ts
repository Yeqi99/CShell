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
        if (p.protocol === 'agent') {
          setTimeout(
            () =>
              (window as any).receive(
                p.id,
                'environments',
                JSON.stringify([
                  { shell: 'powershell', label: 'PowerShell' },
                  { shell: 'wsl', distribution: 'Ubuntu', label: 'WSL · Ubuntu' },
                ]),
              ),
            50,
          );
          return;
        }
        setTimeout(() => {
          (window as any).receive(p.id, 'connected', '');
          (window as any).receive(p.id, 'data', btoa('test-session$ '));
        }, 50);
      },
      resetAgentTrust: (host: string, port: number) => {
        calls.push({ resetTrust: host, port });
        for (const call of calls)
          if (call.protocol === 'agent' && call.host === host && Number(call.port) === port)
            (window as any).receive(call.id, 'closed', '');
        (window as any).agentTrustReset(host, port);
      },
      openAgent: (id: string, index: number) => {
        calls.push({ openAgent: id, index });
        (window as any).receive(id, 'connected', index === 1 ? 'WSL · Ubuntu' : 'PowerShell');
      },
      fileRequest: (data: string) => {
        const r = JSON.parse(data);
        setTimeout(
          () =>
            (window as any).fileEvent(
              JSON.stringify({
                request: r.request,
                path: '/home/test',
                entries: [
                  { name: 'src', path: '/home/test/src', directory: true, size: 0 },
                  { name: 'README.md', path: '/home/test/README.md', directory: false, size: 120 },
                ],
                name: 'README.md',
                text: 'hello file',
              }),
            ),
          30,
        );
      },
      input: (...args: any[]) => calls.push(args),
      resize: () => {},
      acknowledge: () => {},
      disconnect: () => {},
      checkUpdate: () => {
        setTimeout(
          () =>
            (window as any).updateEvent(
              JSON.stringify({ message: '当前已是最新可用版本', busy: false }),
            ),
          500,
        );
      },
      openUpdatePage: () => calls.push('update-page'),
      installUpdate: () => {},
    };
  });
  await page.goto('http://127.0.0.1:' + (server.address() as any).port);
  await mkdir('test-results', { recursive: true });
  assert.equal(await page.locator('#connect').isVisible(), false);
  await page.screenshot({ path: 'test-results/android-home.png' });
  await page.locator('#home-new').click();
  assert.equal(await page.locator('#connection-fields').isVisible(), false);
  await page.locator('#protocol-ssh').click();
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
  assert.equal(await page.locator('#server-list .server-open').count(), 1);
  assert.ok(
    !(await page.evaluate(() => localStorage.getItem('profiles')))?.includes(
      'secret-not-persisted',
    ),
  );
  await page.screenshot({ path: 'test-results/android-servers.png' });
  await page.locator('#server-list .server-open').click();
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
  await page.locator('#navigation [data-page=home]').click();
  await page.locator('#navigation [data-page=session-page]').click();
  assert.equal(await page.locator('#terminals > .terminal').count(), 1);
  assert.ok(await page.locator('.xterm-screen').isVisible());
  await page.locator('#navigation [data-page=files]').click();
  await page.locator('#files-list .server-open').first().waitFor();
  assert.equal(await page.locator('#files-list .server-open').count(), 2);
  await page.screenshot({ path: 'test-results/android-files.png' });
  await page.locator('#files-list .server-open').last().click();
  await page.locator('#file-preview').waitFor();
  assert.equal(await page.locator('#preview-text').innerText(), 'hello file');
  await page.locator('#navigation [data-page=session-page]').click();
  await page.setViewportSize({ width: 320, height: 480 });
  assert.equal(await page.evaluate(() => document.body.scrollWidth <= window.innerWidth), true);
  await page.setViewportSize({ width: 852, height: 393 });
  assert.equal(await page.locator('#minimal').isVisible(), true);
  await page.locator('[data-page=settings]').click();
  await page.locator('#theme').click();
  await page.locator('#check-update').click();
  assert.equal(await page.locator('#check-update').isDisabled(), true);
  assert.equal(await page.locator('#update-status').textContent(), '正在检查更新…');
  await page.getByText('当前已是最新可用版本', { exact: true }).waitFor();
  await page.locator('#update-page').click();
  assert.ok(await page.evaluate(() => (window as any).nativeCalls.includes('update-page')));
  assert.equal(await page.locator('#update-status').innerText(), '当前已是最新可用版本');
  await page.setViewportSize({ width: 393, height: 852 });
  await page.screenshot({ path: 'test-results/android-settings-dark.png' });
  await page.reload();
  await page.locator('#home').waitFor();
  assert.equal(await page.locator('#server-list .server-open').count(), 1);
  assert.equal(await page.locator('body.dark').count(), 1);
  await page.locator('#new').click();
  await page.locator('#protocol-agent').click();
  assert.equal(await page.locator('#username-field').isVisible(), false);
  assert.equal(await page.locator('#ssh-auth').isVisible(), false);
  assert.equal(await page.locator('[name=port]').inputValue(), '47831');
  await page.locator('[name=host]').fill('agent.test');
  await page.locator('[name=name]').fill('我的电脑');
  await page.locator('[name=password]').fill('agent-secret-not-persisted');
  await page.locator('[name=favorite]').check();
  await page.locator('button[type=submit]').click();
  await page.getByRole('button', { name: 'Ubuntu · WSL', exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/android-agent-environments.png' });
  await page.getByRole('button', { name: 'Ubuntu · WSL', exact: true }).click();
  assert.equal(await page.locator('#status').innerText(), '已连接');
  assert.ok((await page.locator('#tabs').innerText()).includes('WSL · Ubuntu'));
  assert.ok(
    await page.evaluate(() =>
      (window as any).nativeCalls.some((c: any) => c.index === 1 && c.openAgent),
    ),
  );
  await page.locator('#navigation [data-page=files]').click();
  assert.equal(await page.locator('#files-status').innerText(), '此 Agent 连接尚未提供文件能力');
  assert.equal(await page.locator('#files-upload').isDisabled(), true);
  assert.ok(
    !(await page.evaluate(() => localStorage.getItem('profiles')))?.includes(
      'agent-secret-not-persisted',
    ),
  );
  await page.locator('#navigation [data-page=connections]').click();
  await page.getByRole('button', { name: '编辑 我的电脑', exact: true }).click();
  await page.locator('#agent-identity summary').click();
  await page.getByRole('button', { name: '重新核对设备身份', exact: true }).click();
  assert.ok(
    await page.evaluate(() =>
      (window as any).nativeCalls.some(
        (c: any) => c.resetTrust === 'agent.test' && c.port === 47831,
      ),
    ),
  );
  assert.ok((await page.locator('#form-error').innerText()).includes('下次连接需重新核对身份'));
  const resetProfiles = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('profiles') || '[]'),
  );
  assert.equal(resetProfiles.length, 2);
  assert.equal(resetProfiles.find((p: any) => p.protocol === 'agent').agentAuthorized, false);
  assert.equal(resetProfiles.find((p: any) => p.protocol === 'agent').favorite, true);
  assert.deepEqual(errors, []);
  console.log(
    'Android web workbench: navigation, persistence, drafts, sessions, minimal mode, narrow/landscape, update feedback passed. Native SSH/installer require device validation.',
  );
} finally {
  await browser.close();
  server.close();
}
