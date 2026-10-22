import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const server = createServer(async (req, res) => {
  const path = req.url === '/' ? 'index.html' : req.url!.slice(1);
  if (!['index.html', 'app.js', 'app.css', 'icon.png'].includes(path)) {
    res.writeHead(404).end();
    return;
  }
  res.setHeader(
    'Content-Type',
    path.endsWith('.js')
      ? 'application/javascript'
      : path.endsWith('.css')
        ? 'text/css'
        : path.endsWith('.png') ? 'image/png' : 'text/html',
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
        if (p.protocol === 'agent' && p.host === 'phone.test') {
          setTimeout(() => {
            (window as any).receive(p.id, 'environments', '[]');
            (window as any).receive(p.id, 'desktop-status', JSON.stringify({packageReady:true,viewAllowed:false,controlAllowed:false}));
          }, 50);
          return;
        }
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
      desktopOpen: (id:string,options:string) => calls.push({desktopOpen:id,options:JSON.parse(options)}),
      desktopClose: (id:string) => calls.push({desktopClose:id}),
      desktopCommand: () => {},
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
        calls.push({ fileRequest: r });
        if (r.path === '/denied') { setTimeout(() => (window as any).fileEvent(JSON.stringify({request:r.request,error:'没有读取此目录的权限'})), 10); return; }
        setTimeout(
          () =>
            (window as any).fileEvent(
              JSON.stringify({
                request: r.request,
                path: '/home/test',
                parent: null,
                entries: [
                  { name: 'src', path: '/home/test/src', directory: true, size: 0 },
                  { name: 'README.md', path: '/home/test/README.md', directory: false, size: 120 },
                ],
                name: r.session === 'local' && r.operation === 'list' ? '手机文档' : 'README.md',
                text: 'hello file',
              }),
            ),
          30,
        );
      },
      localFilesStatus: () => JSON.stringify({available:false}),
      localFilesChoose: () => (window as any).localFilesChanged(JSON.stringify({available:true,name:'手机文档',path:'content://fixture/tree/docs'})),
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
  await page.waitForFunction(() => (document.querySelector('.brand-mark img') as HTMLImageElement)?.naturalWidth > 0);
  await page.locator('#navigation [data-page=files]').click();
  assert.equal(await page.locator('#files-empty').isVisible(), true);
  assert.equal(await page.locator('#files-session').isVisible(), false);
  assert.equal(await page.locator('#files-path-form').isVisible(), false);
  await page.locator('#files-local').click();
  assert.equal(await page.locator('#files-empty h2').innerText(), '选择手机文件夹');
  await page.locator('#files-choose').click();
  await page.locator('#files-list .server-open').first().waitFor();
  assert.equal(await page.locator('#files-path').inputValue(), '手机文档');
  assert.equal(await page.locator('#files-up').isDisabled(), true);
  assert.equal(await page.locator('#files-path').getAttribute('readonly'), '');
  assert.ok(await page.evaluate(() => (window as any).nativeCalls.some((c:any) => c.fileRequest?.session === 'local')));
  assert.equal(await page.evaluate(() => localStorage.getItem('fileSource')), 'local');
  await page.reload();
  await page.locator('#navigation [data-page=files]').click();
  assert.equal(await page.locator('#files-local').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#files-empty h2').innerText(), '选择手机文件夹');
  await page.locator('#files-remote').click();
  await page.locator('#files-empty [data-page=connections]').click();
  await page.locator('#navigation [data-page=home]').click();
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
  await page.locator('[name=password]:visible').fill('secret-not-persisted');
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
  await page.locator('[name=password]:visible').fill('secret');
  await page.locator('#connect-actions button[type=submit]').click();
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
  await page.locator('#files-path').fill('/denied');
  await page.locator('#files-path-form').evaluate((form:HTMLFormElement) => form.requestSubmit());
  await page.getByText('没有读取此目录的权限', {exact:true}).waitFor();
  assert.equal(await page.locator('#files-list .server-open').count(), 0);
  assert.equal(await page.locator('#file-preview').isVisible(), false);
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
  await page.locator('[name=password]:visible').fill('agent-secret-not-persisted');
  await page.locator('[name=favorite]').check();
  await page.locator('#connect-actions button[type=submit]').click();
  await page.getByRole('button', { name: 'Ubuntu · WSL', exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/android-agent-environments.png' });
  const machineTabs = await page.locator('#tabs .tab').count();
  await page.locator('#navigation [data-page=connections]').click();
  await page.locator('#server-list .server-open').filter({hasText:'我的电脑'}).click();
  assert.equal(await page.locator('#tabs .tab').count(),machineTabs);
  await page.getByRole('button', {name:'Ubuntu · WSL',exact:true}).waitFor();
  await page.getByRole('button', { name: 'Ubuntu · WSL', exact: true }).click();
  assert.equal(await page.locator('#status').innerText(), '已连接');
  assert.ok((await page.locator('#tabs').innerText()).includes('我的电脑'));
  assert.ok(
    await page.evaluate(() =>
      (window as any).nativeCalls.some((c: any) => c.index === 1 && c.openAgent),
    ),
  );
  await page.locator('#navigation [data-page=files]').click();
  await page.locator('#files-list .server-open').first().waitFor();
  assert.equal(await page.locator('#files-empty').isVisible(), false);
  assert.equal(await page.locator('#files-upload').isDisabled(), false);
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
  await page.locator('#new').click();
  await page.locator('#protocol-agent').click();
  await page.locator('[name=host]').fill('phone.test');
  await page.locator('[name=name]').fill('测试手机');
  await page.locator('[name=password]:visible').fill('phone-test');
  await page.locator('#connect-actions button[type=submit]').click();
  const phonePicker=page.locator('.agent-environments:visible');
  await phonePicker.getByRole('heading',{name:'测试手机',exact:true}).waitFor();
  assert.equal(await phonePicker.getByRole('button',{name:'远程控制',exact:true}).isDisabled(),true);
  assert.equal(await phonePicker.locator('[data-app=terminal]').count(),0);
  await page.evaluate(()=>{
    const phone=(window as any).nativeCalls.find((call:any)=>call.host==='phone.test');
    (window as any).receive(phone.id,'desktop-status',JSON.stringify({packageReady:true,viewAllowed:true,controlAllowed:true,qualityModes:['bounded']}));
  });
  await phonePicker.getByRole('button',{name:'远程控制',exact:true}).click();
  await page.locator('.mobile-desktop:visible').waitFor();
  assert.ok(await page.evaluate(()=>(window as any).nativeCalls.some((call:any)=>call.desktopOpen)));
  assert.equal(await page.evaluate(()=>{const phone=(window as any).nativeCalls.find((call:any)=>call.host==='phone.test');return (window as any).nativeCalls.some((call:any)=>call.openAgent===phone.id);}),false);
  await page.locator('.mobile-desktop:visible').getByRole('button',{name:'返回机器',exact:true}).click();
  await phonePicker.waitFor();
  assert.deepEqual(errors, []);
  console.log(
    'Android web workbench: navigation, persistence, drafts, sessions, minimal mode, narrow/landscape, update feedback passed. Native SSH/installer require device validation.',
  );
} finally {
  await browser.close();
  server.close();
}
