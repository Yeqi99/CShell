import {build} from 'esbuild';
import {_electron as electron} from 'playwright';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const host=process.env.CAGENT_TEST_HOST,port=Number(process.env.CAGENT_TEST_PUBLIC_MANAGEMENT_PORT);
if(!host||!port)throw Error('Explicit saved target required');
const dir=await mkdtemp(join(tmpdir(),'desktop-saved-viewer-'));
await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{AgentDesktopView}from'./src/ui/components/AgentDesktopView';createRoot(document.getElementById('root')).render(<AgentDesktopView target="test" canView canControl={false}/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,jsx:'automatic',outfile:join(dir,'view.js')});
await writeFile(join(dir,'index.html'),'<html><head><link rel="stylesheet" href="view.css"></head><body><div id="root"></div><script src="view.js"></script></body></html>');
await build({entryPoints:['src/desktop/preload.ts'],bundle:true,platform:'node',external:['electron'],outfile:join(dir,'preload.cjs')});
const main=`import{app,BrowserWindow,ipcMain,safeStorage}from'electron';import{join}from'node:path';import{ClientVault}from'./src/core/client/identity';import{ClientProvider}from'./src/core/client/provider';import{DesktopViews}from'./src/core/desktop-views';import{connectDesktop}from'./src/core/desktop-client';
const stats={frames:0,decoded:0,errors:[],configs:[],status:undefined};let views,provider;globalThis.fixture={stats,shutdown:async()=>{await views?.dispose();provider?.dispose();}};
app.setPath('userData',join(app.getPath('appData'),'CShell'));
app.whenReady().then(async()=>{
 const vault=new ClientVault(join(app.getPath('userData'),'client-controller'),{encrypt:async()=>{throw Error('Read only vault')},decrypt:async value=>(await safeStorage.decryptStringAsync(Buffer.from(value,'base64'))).result});
 provider=new ClientProvider(vault,()=>{});await provider.load();const device=provider.list().find(d=>d.host===${JSON.stringify(host)}&&d.port===${port});if(!device)throw Error('Saved target unavailable');
 const win=new BrowserWindow({show:false,width:1100,height:800,webPreferences:{preload:${JSON.stringify(join(dir,'preload.cjs'))},contextIsolation:true,sandbox:true,backgroundThrottling:false}});
 views=new DesktopViews({authorize:()=>{},open:async input=>{stats.status=await provider.call(device.deviceId,{method:'desktop.status'},AbortSignal.timeout(15000));const ticket=await provider.call(device.deviceId,{method:'desktop.open',params:{control:false,quality:input.quality,transport:'management'}},AbortSignal.timeout(15000));return{ticket,host:device.host,identity:device.deviceId,local:false,connect:async()=>{const stream=await provider.openDesktopStream(device.deviceId,AbortSignal.timeout(15000));return connectDesktop(ticket,{host:device.host,expectedHostIdentity:device.deviceId,stream});},close:()=>provider.call(device.deviceId,{method:'desktop.close',params:{id:ticket.id}},AbortSignal.timeout(5000))};},publish:e=>{if(e.type==='frame')stats.frames++;if(e.type==='config')stats.configs.push(e.info);if(e.type==='error'||e.type==='closed')stats.errors.push(e);win.webContents.send('desktop:view-event',e);}});
 ipcMain.handle('desktop:view-start',(_,x)=>views.start(x));ipcMain.handle('desktop:view-stop',(_,id)=>views.stop(id));ipcMain.handle('desktop:view-release',(_,id,g)=>views.release(id,g));ipcMain.handle('desktop:view-quality',(_,id,q,g)=>views.quality(id,q,g));ipcMain.handle('desktop:view-input',()=>{throw Error('No input permitted')});ipcMain.handle('desktop:view-ack',(_,id,s,ok,ms,g)=>{if(ok)stats.decoded++;return views.ack(id,s,ok,ms,g)});
 await win.loadFile(${JSON.stringify(join(dir,'index.html'))});
}).catch(e=>{console.error(e);app.exit(1)});`;
// selfsigned is bundled so the temporary fixture can resolve it independently.
await build({stdin:{contents:main,resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',external:['electron'],outfile:join(dir,'main.cjs')});
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({args:[join(dir,'main.cjs')],env});
try{const page=await app.firstWindow();page.setDefaultTimeout(20000);await page.getByRole('button',{name:'连接桌面',exact:true}).click();
 await page.waitForFunction(()=>{const c=document.querySelector('canvas');return !!c&&c.width>1&&c.height>1;},undefined,{timeout:25000});
 await new Promise(r=>setTimeout(r,5000));
 const stats=await app.evaluate(()=>(globalThis as any).fixture.stats);
 assert.ok(stats.decoded>0);
 await writeFile('test-results/desktop-saved-viewer-0.6.28.json',JSON.stringify({passed:true,stats,inputInjected:false,pixelsPersisted:false},null,2));
}catch(e){const stats=await app.evaluate(()=>(globalThis as any).fixture.stats);const alerts=await (await app.firstWindow()).getByRole('alert').allTextContents();await writeFile('test-results/desktop-saved-viewer-0.6.28.json',JSON.stringify({passed:false,error:String(e),alerts,stats},null,2));throw e;
}finally{await app.evaluate(async()=>{await(globalThis as any).fixture.shutdown()}).catch(()=>{});await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}


