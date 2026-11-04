import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const server=createServer(async(req,res)=>{const file=req.url==='/'?'index.html':req.url!.slice(1);if(!['index.html','app.js','app.css','icon.png'].includes(file)){res.writeHead(404).end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'text/html');res.end(await readFile('android/app/src/main/assets/'+file));});
await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:393,height:852}});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  (window as any).__name=(fn:any)=>fn;
  localStorage.setItem('account-render-preferences','invalid-json');
  (window as any).CShellNative={cloudRequest:(text:string)=>{const r=JSON.parse(text);const status={owner:'fixture-a',email:'fixture@example.com',unlocked:true,revision:1};setTimeout(()=>(window as any).receive('', 'cloud-result',JSON.stringify({request:r.request,result:r.action==='status'?{status}:{status,profiles:[],models:[],theme:'dark',preferences:{uiFontSize:16,fontSize:18,lineHeight:1.4},extensions:{opencode:true,docker:false}}})),30);}};
 });
 await page.goto('http://127.0.0.1:'+(server.address() as any).port);
 await page.waitForFunction(()=>document.body.style.fontSize==='16px');
 assert.equal(await page.locator('#synced-extension-choices summary').textContent(),'账号扩展 · 1');
 assert.match(await page.locator('#synced-extension-choices').textContent()||'',/opencode/);
 assert.equal(await page.locator('#cagent-enabled').isChecked(),false,'sync must not open remote service');
 assert.deepEqual(errors,[]);
 console.log('PASS: real mobile DOM consumes cloud typography and choices; malformed cache recovers; remote service stays off');
}finally{await browser.close();server.close();}
