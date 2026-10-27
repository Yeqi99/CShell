import {build} from 'esbuild';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';

// Actual React hook with controlled IPC completion order; no account data.
const bundle=await build({stdin:{contents:`
import React from 'react';import{createRoot}from'react-dom/client';import{useAiDrafts}from'./src/ui/ai-drafts';
const pending=[];window.pending=pending;
window.cshell={aiDrafts:()=>new Promise((resolve,reject)=>{window.restore={resolve,reject}}),aiDraftSave:(id,text)=>new Promise((resolve,reject)=>pending.push({id,text,resolve,reject}))};
function App(){const[drafts,update,error]=useAiDrafts();window.edit=(id,text)=>update(p=>({...p,[id]:text}));return <><output id="drafts">{JSON.stringify(drafts)}</output><div role="status">{error}</div></>}
createRoot(document.getElementById('root')).render(<App/>);
`,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,jsx:'automatic'});
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'application/javascript':'text/html;charset=utf-8');res.end(req.url==='/app.js'?bundle.outputFiles[0].contents:'<!doctype html><div id="root"></div><script src="/app.js"></script>');});
await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
const owned=await chromium.launchServer({channel:process.platform==='win32'?'msedge':undefined});
try{
 const browser=await chromium.connect(owned.wsEndpoint()),page=await browser.newPage(),errors:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));
 const url='http://127.0.0.1:'+(server.address() as any).port;
 await page.goto(url);await page.waitForFunction(()=>!!(window as any).restore);
 const edit=async(id:string,text:string)=>{await page.evaluate(({id,text})=>(window as any).edit(id,text),{id,text});};
 const settle=async(index:number,fail=false)=>{await page.evaluate(({index,fail})=>{const p=(window as any).pending[index];if(fail)p.reject(Error('fixture write failed'));else p.resolve();},{index,fail});};
 const warning=async(expected:boolean)=>{await page.waitForFunction(expected=>!!document.querySelector('[role=status]')!.textContent===expected,expected);};
 await edit('a','typed before restore');await page.evaluate(()=>(window as any).restore.resolve({a:'old',b:'saved'}));
 await page.waitForFunction(()=>document.querySelector('#drafts')!.textContent!.includes('saved'));
 assert.equal(JSON.parse((await page.locator('#drafts').textContent())!).a,'typed before restore');
 await settle(0,true);await warning(true);
 await edit('b','new b');await settle(1);await warning(true); // Another draft cannot hide A's failure.
 await edit('a','recovered');await settle(2);await warning(false);
 await edit('a','older');await edit('a','newer');await settle(4);await settle(3,true);await warning(false);
 await edit('a','old success');await edit('a','latest failure');await settle(6,true);await settle(5);await warning(true);
 await edit('a','');await settle(7);await warning(false);
 await page.reload();await page.waitForFunction(()=>!!(window as any).restore);
 await page.evaluate(()=>(window as any).restore.reject(Error('fixture restore failed')));await warning(true);
 await edit('a','still editable');await settle(0);await warning(true);
 assert((await page.locator('div[role=status]').textContent())!.includes('恢复失败'));
 assert.deepEqual(errors,[]);
 console.log('PASS real draft hook: delayed restore, per-thread failure isolation, recovery, stale completion ordering, clear draft, restore failure retained');
}finally{await owned.kill();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
