import { build } from 'esbuild';
import { chromium } from 'playwright';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const directory = await mkdtemp(join(tmpdir(), 'cshell-mobile-apps-'));
await build({
  stdin: {
    contents: `import {MobileCoding} from './android/web/coding';import {MobileIde} from './android/web/ide';import './android/web/style.css';
const bridge={browserOpen:(id,name,url)=>window.opened={id,name,url},machineRequest:json=>{const p=JSON.parse(json);let result={};if(p.method==='coding.status')result={directory:'/data/coding',engines:[{engine:'codex',ready:true,path:'/private/codex',version:'fixture'}],profiles:[{id:'11111111-1111-4111-8111-111111111111',engine:'codex',name:'工作基座',auth:'official',endpoint:'',model:''}],installs:[]};if(p.method==='coding.tasks')result=[];if(p.method==='ide.status')result={ready:true,supported:true,directory:'/data/ide',version:'fixture'};if(p.method==='ide.start')result={url:'http://127.0.0.1:8080/?folder=%2Fdata%2Fproject',password:'fixture-password',cwd:'/data/project'};setTimeout(()=>{coding.receive(p.session,JSON.stringify({request:p.request,result}));ide.receive(p.session,JSON.stringify({request:p.request,result}));},0)}};
const coding=new MobileCoding(bridge),ide=new MobileIde(bridge);window.showCoding=()=>coding.open('machine-a','美国机器','codex');window.showIde=()=>{coding.close();ide.open('machine-a','美国机器');};window.showCoding();`,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  jsx: 'automatic',
  outfile: join(directory, 'fixture.js'),
});
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 393, height: 852 },
    isMobile: true,
    hasTouch: true,
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', (route) => route.abort());
  await page.route('https://fixture.invalid/', (r) =>
    r.fulfill({
      contentType: 'text/html',
      body: '<meta name="viewport" content="width=device-width,initial-scale=1"><div></div>',
    }),
  );
  await page.goto('https://fixture.invalid/');
  await page.addStyleTag({ content: await readFile(join(directory, 'fixture.css'), 'utf8') });
  await page.addScriptTag({ content: await readFile(join(directory, 'fixture.js'), 'utf8') });
  await page.getByRole('button', { name: '会话与设置' }).click();
  await page.getByRole('button', { name: '账号与基座', exact: true }).click();
  await page
    .getByText('工作基座', { exact: true })
    .first()
    .waitFor()
    .catch(async (e) => {
      console.log(errors);
      console.log(await page.locator('body').innerText());
      await page.screenshot({ path: 'test-results/mobile-coding-failure.png' });
      throw e;
    });
  assert.equal(await page.locator('.coding-sidebar').isVisible(), false);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: 'test-results/mobile-coding-accounts.png' });
  await page.evaluate(() => (window as any).showIde());
  await page.getByLabel('项目目录').fill('/data/project');
  await page.getByRole('button', { name: '打开项目' }).click();
  await page.waitForFunction(() => (window as any).opened);
  assert.equal(await page.evaluate(() => (window as any).opened.id), 'machine-a');
  for (const viewport of [
    { width: 393, height: 852 },
    { width: 852, height: 393 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await page.setViewportSize({ width: 393, height: 852 });
  await page.screenshot({ path: 'test-results/mobile-ide.png' });
  assert.deepEqual(errors, []);
  console.log(
    'PASS mobile coding menu, provider panel, IDE target binding and responsive layouts; all external requests blocked',
  );
} finally {
  await browser.close();
}
