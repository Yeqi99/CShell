import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const dir = await mkdtemp(join(tmpdir(), 'member-model-menu-'));
const poolId = '4fcbb45b-efb3-450f-97ac-f7001ab25aaa';
await build({stdin: {loader: 'tsx', resolveDir: process.cwd(), contents: `
  import React from 'react';
  import {createRoot} from 'react-dom/client';
  import {AiModelMenu} from './src/ui/components/AiModelMenu';
  import {officialModelUrl} from './src/shared/official-models';
  const pooled = {id:'${poolId}',url:officialModelUrl,model:'pool-${poolId}',name:'Old name · Pro'};
  const privateModel = {id:'mine',url:'https://example.org/v1',model:'mine',name:'个人模型'};
  window.cshell = {
    cloudStatus:async()=>({email:'user@example.org',membership:{active:true}}),
    cloudTraffic:async()=>({modelWeek:{percent:72,resetAt:1800000000,pools:[{models:[{id:pooled.model,name:'会员测试模型',tier:'high',costTier:'elevated',speed:{level:'slow',first:3.4,cps:24,samples:3,measured:1800000000}}]}]}}),
    plugins:async()=>[], onAiProvidersChanged:()=>()=>{}, aiExtensionCall:async()=>{document.body.dataset.unexpectedOpenCode='1';throw Error('未启用 OpenCode');}
  };
  function TestMenu(){ const [id,setId]=React.useState('mine'); return <AiModelMenu providers={[pooled,privateModel]} providerId={id} disabled={false}
    configure={()=>{}} onSelect={async id=>{setId(id);document.querySelector('output').textContent=id}}/>; }
  createRoot(document.querySelector('main')).render(<TestMenu/>);
  `}, outfile:join(dir,'app.js'),bundle:true,jsx:'automatic'});
const server = createServer(async (request, response) => {
  if (request.url === '/app.js' || request.url === '/app.css') {
    response.setHeader('Content-Type',request.url.endsWith('.js') ? 'application/javascript' : 'text/css');
    response.end(await readFile(join(dir, request.url.slice(1))));
  } else {
    response.setHeader('Content-Type','text/html; charset=utf-8');
    response.end('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/app.css"><main></main><output></output><script src="/app.js"></script>');
  }
});
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser = await chromium.launch({channel:'msedge',headless:true});
try {
  const page = await browser.newPage({viewport:{width:360,height:750}});
  page.on('pageerror', error => console.error(error));
  const address = server.address();
  assert(address && typeof address !== 'string');
  await page.goto('http://127.0.0.1:'+address.port);
  const quota = page.getByRole('button',{name:'本周剩余额度 72%'});
  await quota.waitFor();
  await page.getByRole('button',{name:'AI 基座与模型'}).click();
  const menu = page.getByRole('dialog');
  await menu.getByRole('button',{name:/个人模型/}).waitFor();
  assert.equal(await menu.getByText('会员测试模型').count(),0);
  assert.equal(await menu.getByText('OpenCode',{exact:true}).count(),0);
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  assert.equal(await page.getByText('操作未完成').count(),0);
  await menu.getByRole('button',{name:/会员模型/}).click();
  await menu.getByRole('button',{name:'会员测试模型 较高消耗 · 速度较慢'}).click();
  assert.equal(await page.locator('output').textContent(),poolId);
  const trigger = page.getByRole('button',{name:'AI 基座与模型'});
  assert.equal(await trigger.locator('span').textContent(),'会员测试模型');
  assert.equal(await trigger.locator('.member-model-metrics svg').count(),2);
  await quota.click();
  await menu.getByText(/下次刷新/).waitFor();
  assert.equal(await menu.getByRole('button',{name:/个人模型/}).count(),0);
  assert.equal(await menu.getByText('OpenCode',{exact:true}).count(),0);
  assert.equal(await page.locator('body').getAttribute('data-unexpected-open-code'),null);
  const rect = await menu.boundingBox();
  assert(rect && rect.x>=0 && rect.x+rect.width<=360);
  console.log('Member model selection, cost tier, wallet gauge, reset and narrow menu passed.');
} finally {
  await browser.close();
  server.close();
  await rm(dir,{recursive:true,force:true});
}
