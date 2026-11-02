import {build} from 'esbuild';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
const dir=await mkdtemp(join(tmpdir(),'ping-all-'));
await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {PingAll} from './src/ui/components/PingAll';import {PingButton} from './src/ui/components/PingButton';import './src/ui/styles.css';
window.calls=[];window.cshell={networkPing:async ({profileId})=>{window.calls.push(profileId);await new Promise(r=>setTimeout(r,20));return {status:'reply',elapsedMs:profileId==='one'?10:200,targetAddress:profileId,checkedAt:new Date().toISOString()}}};
function App(){const [interval,set]=useState(0);return <main><PingAll profiles={[{id:'one',protocol:'ssh'},{id:'two',protocol:'client'},{id:'http',protocol:'http'}]} interval={interval} onInterval={async v=>{set(v);window.saved=v}}/><PingButton profileId="one"/><PingButton profileId="two"/></main>}createRoot(document.getElementById('root')).render(<App/>);`},bundle:true,jsx:'automatic',outfile:join(dir,'app.js')});
const server=createServer(async(req,res)=>{const n=req.url==='/app.js'?'app.js':req.url==='/app.css'?'app.css':null;res.setHeader('Content-Type',n?n.endsWith('css')?'text/css':'text/javascript':'text/html; charset=utf-8');res.end(n?await readFile(join(dir,n)):'<html><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script></html>')});
await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'msedge'});
try{const page=await browser.newPage();await page.goto('http://127.0.0.1:'+(server.address() as any).port);const button=page.getByRole('button',{name:'本机 Ping 全部服务器'});await button.click();await page.getByRole('button',{name:'本机 Ping 服务器'}).filter({hasText:'200 ms'}).waitFor();assert.deepEqual(await page.evaluate(()=>(window as any).calls),['one','two']);assert.equal((await button.innerText()).trim(),'');
for(const width of [320,390,700]) for(const corner of ['left','right']){await page.setViewportSize({width,height:480});await page.evaluate(corner=>{document.body.style.zoom='1.25';const main=document.querySelector('main')!;Object.assign(main.style,{position:'fixed',left:corner==='left'?'0':'auto',right:corner==='right'?'0':'auto',bottom:'0'});},corner);await button.click({button:'right'});const menu=page.getByRole('dialog',{name:'自动 Ping 设置'});await menu.waitFor();const rect=await menu.boundingBox();assert(rect&&rect.x>=0&&rect.y>=0&&rect.x+rect.width<=width&&rect.y+rect.height<=480,JSON.stringify(rect));assert.equal(await button.getAttribute('title'),null);await page.keyboard.press('Escape');}
await page.evaluate(()=>{document.body.style.zoom='1'});await button.click({button:'right'});await page.getByLabel('自动 Ping 间隔').selectOption('60');assert.equal(await page.evaluate(()=>(window as any).saved),60);await page.getByRole('button',{name:'完成'}).click();assert.equal(await page.getByLabel('自动 Ping 间隔').count(),0);console.log('PASS Ping all targets separately, excludes HTTP, renders each result, saves interval');}finally{await browser.close();server.close();await rm(dir,{recursive:true,force:true});}
