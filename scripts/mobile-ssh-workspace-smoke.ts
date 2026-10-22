import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  for (const width of [393, 768]) {
    const page = await browser.newPage({
      viewport: { width, height: 852 },
      isMobile: true,
      hasTouch: true,
    });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/*', async (route) => {
      const name = new URL(route.request().url()).pathname.split('/').pop() || 'index.html';
      if (!['index.html', 'app.js', 'app.css', 'icon.png'].includes(name)) return route.abort();
      await route.fulfill({
        body: await readFile('android/app/src/main/assets/' + name),
        contentType: name.endsWith('.js')
          ? 'application/javascript'
          : name.endsWith('.css')
            ? 'text/css'
            : name.endsWith('.png')
              ? 'image/png'
              : 'text/html',
      });
    });
    await page.addInitScript(
      `{const w=window;w.CShellNative=new Proxy({version:()=> '0.8.0',agentSupported:()=>true,browserSupported:()=>true,browserOpen:(id)=>w.browserTarget=id,connect:(json)=>{const p=JSON.parse(json);w.session=p.id;setTimeout(()=>{w.receive(p.id,'connected','');w.receive(p.id,'data',btoa('retained terminal output'));w.receive(p.id,'ssh-workspace','ready');w.receive(p.id,'machine-apps',JSON.stringify({browser:true,market:true,codex:true}));},10);}}, {get:(t,k)=>k in t?t[k]:()=>{}});}`,
    );
    await page.goto('https://fixture.invalid/');
    await page.locator('#new').click();
    await page.locator('#protocol-ssh').click();
    await page.locator('[name=host]').fill('fixture.invalid');
    await page.locator('[name=username]').fill('root');
    await page.locator('button[type=submit][form=connect]').click();
    await page.getByText('cagent 工作区 · 通过 SSH 连接').waitFor();
    await page.getByRole('button', { name: '浏览器', exact: true }).click();
    assert.equal(
      await page.evaluate(() => (window as any).browserTarget),
      await page.evaluate(() => (window as any).session),
    );
    await mkdir('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/mobile-ssh-workspace-' + width + '.png' });
    await page.getByRole('button', { name: 'SSH 终端', exact: true }).click();
    assert.equal(await page.locator('.ssh-workspace').isVisible(), false);
    await page.getByRole('button', { name: '返回机器桌面' }).click();
    assert.equal(await page.locator('.ssh-workspace').isVisible(), true);
    assert.ok(await page.locator('.xterm-screen').count());
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.evaluate(() => {
      const w = window as any;
      w.receive(w.session, 'closed', '');
    });
    assert.equal(await page.locator('.machine-home').count(), 0);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(
    'PASS SSH machine home, browser target, terminal return, disconnect and mobile/tablet layout',
  );
} finally {
  await browser.close();
}
