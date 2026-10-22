import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  for (const mode of ['ssh', 'agent'])
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
        `{const w=window;w.CShellNative=new Proxy({version:()=> '0.8.0',agentSupported:()=>true,browserSupported:()=>true,fileRequest:json=>w.fileTarget=JSON.parse(json).session,machineRequest:json=>{const p=JSON.parse(json);let result={};if(p.method==='coding.status')result={supported:true,engines:[],profiles:[],installs:[],directory:'/private/coding'};if(p.method==='ide.status')result={supported:true,ready:false};if(p.method==='applications.list')result={platform:'linux',manager:'apt',enabled:true,applications:[{id:'git',package:'git'},{id:'browser',package:'chrome'}]};if(p.method==='applications.policy')result={enabled:true,controllers:['*']};if(p.method==='applications.plan')result={id:'3b3cb565-c4b8-4b88-bfd2-37cbdb045afc',app:'git',platform:'linux',manager:'apt',executable:'apt-get',args:['install','git'],expires:Date.now()+60000,state:'planned',logs:'',warning:'系统应用安装'};setTimeout(()=>w.receive(p.session,'machine-result',JSON.stringify({request:p.request,result})),0)},openAgent:(id)=>{w.opens=(w.opens||0)+1;setTimeout(()=>w.receive(id,'connected','PowerShell'),0)},browserOpen:(id)=>w.browserTarget=id,connect:(json)=>{const p=JSON.parse(json);w.session=p.id;setTimeout(()=>{if(p.protocol==='agent')w.receive(p.id,'environments',JSON.stringify([{shell:'powershell',label:'PowerShell'}]));else{w.receive(p.id,'connected','');w.receive(p.id,'ssh-workspace','ready');}w.receive(p.id,'data',btoa('retained terminal output'));w.receive(p.id,'machine-apps',JSON.stringify({browser:true,market:true,codex:true,files:true}));},10);}}, {get:(t,k)=>k in t?t[k]:()=>{}});}`,
      );
      await page.goto('https://fixture.invalid/');
      await page.locator('#new').click();
      await page.locator('#protocol-' + mode).click();
      await page.locator('[name=host]').fill('fixture.invalid');
      if (mode === 'ssh') await page.locator('[name=username]').fill('root');
      await page.locator('button[type=submit][form=connect]').click();
      await page.locator('.machine-desktop').waitFor();
      await page.getByRole('button', { name: '桌面设置' }).click();
      await page.getByRole('button', { name: '暮色背景' }).click();
      assert.equal(await page.locator('.machine-desktop').getAttribute('data-wallpaper'), 'dusk');
      await page.getByRole('button', { name: '深色', exact: true }).click();
      await page.getByRole('button', { name: '返回机器桌面' }).click();
      await page.getByRole('textbox', { name: '搜索这台机器的应用' }).fill('浏览');
      assert.equal(await page.locator('.machine-tile').count(), 1);
      await page.getByRole('textbox', { name: '搜索这台机器的应用' }).fill('');
      await page.getByRole('button', { name: '浏览器', exact: true }).click();
      assert.equal(
        await page.evaluate(() => (window as any).browserTarget),
        await page.evaluate(() => (window as any).session),
      );
      await mkdir('test-results', { recursive: true });
      await page.screenshot({
        path: 'test-results/mobile-' + mode + '-workspace-' + width + '.png',
      });
      await page
        .getByRole('button', { name: mode === 'ssh' ? 'SSH 终端' : 'PowerShell', exact: true })
        .click();
      await page.locator('.machine-desktop').waitFor({ state: 'hidden' });
      await page.getByRole('button', { name: '返回机器桌面' }).click();
      assert.equal(await page.locator('.machine-desktop').isVisible(), true);
      if (mode === 'agent') {
        await page.locator('.machine-tile[data-app=terminal]').click();
        assert.equal(await page.evaluate(() => (window as any).opens), 1);
        await page.getByRole('button', { name: '返回机器桌面' }).click();
      }
      if(mode==='agent'){
        await page.evaluate(()=>{const w=window as any;w.receive(w.session,'desktop-status',JSON.stringify({packageReady:true,viewAllowed:true,controlAllowed:true}));});
        await page.locator('.machine-tile[data-app=remote]').click();
        assert.equal(await page.locator('.desktop-control-panel').getAttribute('open'),null);
        await page.screenshot({path:'test-results/mobile-remote-'+width+'.png'});
        await page.locator('.desktop-control-panel>summary').click();await page.getByRole('button',{name:'Alt+Tab',exact:true}).waitFor();await page.getByRole('button',{name:'返回机器',exact:true}).click();
      }
      await page.locator('.machine-tile[data-app=files]').click();
      assert.equal(
        await page.evaluate(() => (window as any).fileTarget),
        await page.evaluate(() => (window as any).session),
      );
      await page.locator('#back').click();
      await page.locator('.machine-desktop').waitFor();
      await page.locator('.machine-tile[data-app=market]').click();
      await page.getByRole('button', { name: 'git git', exact: true }).click();
      await page.getByRole('button', { name: '确认并安装' }).waitFor();
      assert.equal(await page.getByText('Linux 图形环境', { exact: true }).count(), 0);
      await page.screenshot({ path: 'test-results/mobile-market-' + mode + '-' + width + '.png' });
      await page.getByRole('button', { name: '‹ 返回机器' }).click();
      assert.ok(await page.locator('.xterm-screen').count());
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.evaluate(() => {
        const w = window as any;
        w.receive(w.session, 'closed', '');
      });
      assert.equal(await page.locator('.machine-home').count(), 0);
      assert.equal(await page.locator('.machine-desktop').getAttribute('data-offline'), 'true');
      assert.deepEqual(errors, []);
      await page.close();
    }
  console.log(
    'PASS SSH machine home, browser target, terminal return, disconnect and mobile/tablet layout',
  );
} finally {
  await browser.close();
}
