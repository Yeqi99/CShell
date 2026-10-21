import { build } from 'esbuild';
import { chromium } from 'playwright';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const dir = await mkdtemp(join(tmpdir(), 'market-test-'));
await build({
  stdin: {
    contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {DevelopmentMarket} from './src/ui/components/DevelopmentMarket';import {CodingApp} from './src/ui/components/CodingApp';import './src/ui/styles.css';
window.calls=[];window.opened=[];let ready=false,profiles=[];
const call=async(method,p)=>{window.calls.push({method,p});if(method==='coding.status')return {supported:true,directory:'/data/apps',engines:[{engine:'codex',ready,version:'1.0'}],profiles,installs:[],permissions:{codex:'read'}};if(method==='ide.status')return {supported:false};if(method==='coding.install.plan')return {id:'plan',directory:p.directory,version:'1.0',steps:['verify']};if(method==='coding.install'){ready=true;return {id:'job'}};if(method==='coding.tasks')return [];if(method==='coding.profile.save'){profiles=[{...p,hasKey:false}];return {saved:true}};if(method==='coding.login'||method==='coding.login.status')return {id:'login',url:'https://auth.fixture.invalid/',state:'running'};};
const root=createRoot(document.getElementById('app'));root.render(<DevelopmentMarket call={call} onOpen={()=>root.render(<CodingApp engine="codex" name="Fixture" call={call} openBrowser={async u=>window.opened.push(u)} active={true}/> )}/>);`,
    resolveDir: process.cwd(),
    loader: 'tsx',
  },
  bundle: true,
  jsx: 'automatic',
  outfile: join(dir, 'fixture.js'),
});
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } }),
    errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', (r) => r.abort());
  await page.route('https://fixture.invalid/', (r) =>
    r.fulfill({ contentType: 'text/html', body: '<div id="app" style="height:100vh"></div>' }),
  );
  await page.goto('https://fixture.invalid/');
  await page.addStyleTag({ content: await readFile(join(dir, 'fixture.css'), 'utf8') });
  await page.addScriptTag({ content: await readFile(join(dir, 'fixture.js'), 'utf8') });
  await page.getByRole('button', { name: /Codex.*安装/ }).waitFor();
  assert.equal(await page.evaluate(()=>(window as any).calls.filter((c:any)=>c.method==='coding.status').length),1);
  await page.getByRole('button', { name: /Codex.*安装/ }).click();
  assert.equal(await page.getByText('代码编辑器', { exact: true }).count(), 0);
  await page.getByRole('button', { name: '获取安装计划' }).click();
  await page.getByRole('button', { name: '确认安装' }).waitFor();
  assert.equal(
    await page.evaluate(() =>
      (window as any).calls.some((c: any) => c.method === 'coding.install'),
    ),
    false,
  );
  await page.getByRole('button', { name: '确认安装' }).click();
  await page.getByRole('button', { name: '打开', exact: true }).click();
  await page.getByRole('button', { name: /使用 ChatGPT 登录/ }).click();
  await page.waitForFunction(() => (window as any).opened.length === 1);
  await page.getByRole('button', { name: /使用 API 基座/ }).click();
  await page.getByText('API Key', { exact: true }).waitFor();
  for (const width of [1000, 393]) {
    await page.setViewportSize({ width, height: 700 });
    assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= width);
    await page.screenshot({ path: 'test-results/market-login-' + width + '.png' });
  }
  assert.deepEqual(errors, []);
  console.log(
    'PASS platform filtering, explicit install plan, verified open, official browser login and API setup',
  );
} finally {
  await browser.close();
}
