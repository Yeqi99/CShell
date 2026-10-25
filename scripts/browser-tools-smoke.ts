import { build } from 'esbuild';
import { _electron as electron } from 'playwright';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'cshell-browser-tools-'));
await build({stdin:{contents:`
import {app,BrowserWindow} from 'electron';
import {EventEmitter} from 'node:events';import {createConnection} from 'node:net';import {createServer} from 'node:http';
import assert from 'node:assert/strict';import {MachineBrowser} from './src/desktop/machine-browser';
app.setPath('userData',process.env.BROWSER_TEST_DATA!);
app.whenReady().then(async()=>{
 const window=new BrowserWindow({show:false,width:1000,height:800}),id='11111111-1111-4111-8111-111111111111';let forwards=0;
 const client=Object.assign(new EventEmitter(),{forwardOut:(_a,_b,host,port,done)=>{forwards++;const socket=createConnection({host:host==='localhost'?'127.0.0.1':host,port},()=>done(null,socket));socket.once('error',e=>done(e));}}),connection={client,profile:{id:'fixture',host:'127.0.0.1',port:22,username:'test'},closed:false};
 const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');if(req.url==='/second'){res.end('<h1>Second page</h1>');return;}if(req.url==='/child'){res.end('<label>Frame field<input id="child"></label><button onclick="document.body.append(document.createTextNode(&quot;frame-clicked&quot;))">Frame action</button>');return;}res.setHeader('Set-Cookie','session=fixture; HttpOnly');res.setHeader('Content-Type','text/html');res.end('<h1>Browser fixture</h1><label>Label<input id="text"></label><input type="password" value="secret-never-read"><button onclick="document.querySelector(&quot;#result&quot;).textContent=document.querySelector(&quot;#text&quot;).value">Apply</button><div id="result"></div><a href="/second">Next</a><div id="shadow"></div><script>document.querySelector("#shadow").attachShadow({mode:"open"}).innerHTML="<button>Shadow action</button>";</script><iframe src="http://localhost:'+server.address().port+'/child"></iframe>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const url='http://127.0.0.1:'+server.address().port,browser=new MachineBrowser(window,{get:()=>{if(connection.closed)throw Error('SSH disconnected');return connection;}} as any),signal=new AbortController().signal;
 try{
 const opened=await browser.automation(id,'open',{url},signal),tabId=opened.tabId;
 const first=await browser.automation(id,'snapshot',{tabId},signal);assert.ok(first.text.includes('Browser fixture'));assert.ok(!JSON.stringify(first).includes('secret-never-read'));assert.ok(forwards>0,'must use selected machine tunnel');
 assert.ok(first.elements.some(e=>e.name==='Shadow action'),'open shadow root is discoverable');
 globalThis.diagnostics=await (browser as any).resolved.get(id).tabs.get(tabId).view.webContents.executeJavaScript('JSON.stringify({width:innerWidth,height:innerHeight,rect:document.querySelector("button").getBoundingClientRect().toJSON()})');
 const field=first.elements.find(e=>e.name==='Label'),button=first.elements.find(e=>e.name==='Apply');assert.ok(field&&button);
 await browser.automation(id,'interact',{action:'fill',tabId,snapshotId:first.snapshotId,ref:field.ref,text:'typed value'},signal);
 await browser.automation(id,'interact',{action:'click',tabId,snapshotId:first.snapshotId,ref:button.ref},signal);
 await new Promise(r=>setTimeout(r,200));const second=await browser.automation(id,'snapshot',{tabId},signal);assert.ok(!second.text.includes('typed value'));assert.ok(second.text.includes('[输入内容已隐藏]'));
 await assert.rejects(browser.automation(id,'interact',{action:'click',tabId,snapshotId:first.snapshotId,ref:button.ref},signal),/变化/);
 const image=await browser.automation(id,'capture',{tabId,maxWidth:640},signal);assert.equal(image.mimeType,'image/jpeg');assert.ok(image.width<=640&&image.height<=640);assert.ok(Buffer.from(image.dataBase64,'base64').length>100);
 const frames=await browser.automation(id,'frames',{tabId},signal),frame=frames.frames.find(f=>f.url.endsWith('/child'));assert.ok(frame,'cross-origin child is discoverable');
 const child=await browser.automation(id,'snapshot',{tabId,frameId:frame.id},signal),childField=child.elements.find(e=>e.name==='Frame field'),childButton=child.elements.find(e=>e.name==='Frame action');globalThis.diagnostics=JSON.stringify(child);assert.ok(childField&&childButton);
 await browser.automation(id,'interact',{action:'fill',tabId,frameId:frame.id,snapshotId:child.snapshotId,ref:childField.ref,text:'frame-value'},signal);
 await browser.automation(id,'interact',{action:'click',tabId,frameId:frame.id,snapshotId:child.snapshotId,ref:childButton.ref},signal);
 const childAfter=await browser.automation(id,'snapshot',{tabId,frameId:frame.id},signal);assert.ok(childAfter.text.includes('frame-clicked'));
 const pages=await browser.automation(id,'crawl',{tabId,urls:[url+'/second']},signal);assert.ok(pages.pages[0].text.includes('Second page'));
 await assert.rejects(browser.automation(id,'crawl',{tabId,urls:['https://example.com']},signal),/同源/);
 await assert.rejects(browser.automation(id,'interact',{action:'evaluate',tabId,code:'alert(1)'},signal));
 connection.closed=true;client.emit('close');await assert.rejects(browser.automation(id,'snapshot',{tabId},signal),/disconnected|断开/);
 globalThis.result={ok:true,forwards,width:image.width,height:image.height};
 }catch(e){globalThis.result={error:String(e),stack:e.stack,diagnostics:globalThis.diagnostics};}finally{server.close();}
});`,resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',external:['electron'],outfile:join(dir,'main.cjs')});
const env={...process.env,BROWSER_TEST_DATA:join(dir,'data')};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({args:[join(dir,'main.cjs')],env});
try{let result:any;for(let i=0;i<200;i++){result=await app.evaluate(()=>globalThis['result']);if(result)break;await new Promise(r=>setTimeout(r,100));}if(!result?.ok)throw Error(JSON.stringify(result));console.log('PASS real Electron browser tools',JSON.stringify(result));}finally{await app.close();}
