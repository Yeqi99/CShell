import {build} from 'esbuild';
import {_electron as electron} from 'playwright';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
const directory=await mkdtemp(join(tmpdir(),'cagent-real-ipc-'));
const managed=process.argv.includes('--managed'),relayed=process.argv.includes('--relay'),reconnect=process.argv.includes('--reconnect');
const evidenceFile=managed?'test-results/cagent-desktop-managed-ipc.json':'test-results/cagent-desktop-electron-ipc.json';
const native=resolve(process.env.DESKTOP_TEST_NATIVE??'release/0.6.11/agent-win32-x64/cagent-desktop.exe');
await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{AgentDesktopView}from'./src/ui/components/AgentDesktopView';createRoot(document.getElementById('root')).render(<AgentDesktopView target="local" canView={true} canControl={false}/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,jsx:'automatic',outfile:join(directory,'view.js')});
await writeFile(join(directory,'index.html'),'<html><head><link rel="stylesheet" href="view.css"></head><body><div id="root"></div><script src="view.js"></script></body></html>');
await build({entryPoints:['src/desktop/preload.ts'],platform:'node',bundle:true,external:['electron'],outfile:join(directory,'preload.cjs')});
const main=`import{app,BrowserWindow,ipcMain,screen}from'electron';import{DesktopService}from'./src/agent/desktop-service';import{DesktopViews}from'./src/core/desktop-views';import{ClientServer}from'./src/core/client/server';import{ClientProvider}from'./src/core/client/provider';import{ClientVault}from'./src/core/client/identity';import{AgentRelayService}from'./src/agent/relay';import{connectDesktop}from'./src/core/desktop-client';
app.setPath('userData',${JSON.stringify(join(directory,'data'))});
app.whenReady().then(async()=>{
 const diagnostics=[],stats={frames:0,decoded:0,nack:0,closed:[],states:[],frameTimes:[],decodeMs:[]};
 const service=new DesktopService({identity:'ipc-fixture',nativeExecutable:${JSON.stringify(native)},authorize:()=>true,diagnostic:e=>diagnostics.push(e)});
 await service.configure({enabled:true,bindAddress:'127.0.0.1',tcpPort:39138,udpPort:39139,local:{view:true,control:false}});
 const codec={encrypt:async v=>Buffer.from(v).toString('base64'),decrypt:async v=>Buffer.from(v,'base64').toString()};let server,provider,relay,device,owner='local',stream;
 if(${managed}){
  server=new ClientServer(new ClientVault(${JSON.stringify(join(directory,'host'))},codec),{}, {desktopStream:(s,o)=>service.acceptAuthenticated(s,o)});await server.load();await server.setAccess({password:'isolated-fixture-password-2026',shells:['cmd'],allowManage:true});await server.start({bind:'127.0.0.1',port:39140});
  provider=new ClientProvider(new ClientVault(${JSON.stringify(join(directory,'viewer'))},codec),()=>{});await provider.load();let connection;
  if(${relayed}){const vault=new ClientVault(${JSON.stringify(join(directory,'relay'))},codec);relay=new AgentRelayService({vault,identity:await vault.identity()});await relay.load();await relay.configure({enabled:true,bind:'127.0.0.1',port:39141,targets:[{id:'desktop',host:'127.0.0.1',port:39140}]});await relay.start();connection={host:'127.0.0.1',port:39141,fingerprint:relay.status().fingerprint,credential:relay.revealCredential(),targetId:'desktop'};}
  device=await provider.pairPassword(await provider.probe({host:'127.0.0.1',port:39140,...(connection?{relay:connection}:{})}),'isolated-fixture-password-2026');owner=server.status().peers[0].fingerprint;
  await service.configure({enabled:true,directListener:false,ownerGrants:{[owner]:{view:true,control:false}}});
 }
 const win=new BrowserWindow({show:false,width:1000,height:760,webPreferences:{preload:${JSON.stringify(join(directory,'preload.cjs'))},contextIsolation:true,sandbox:true,backgroundThrottling:false}});
 const views=new DesktopViews({authorize:()=>{},open:async input=>{const ticket=service.open(owner,{control:false,quality:input.quality,...(${managed}?{transport:'management'}:{})});return{ticket,identity:'ipc-fixture',host:'127.0.0.1',local:true,...(${managed}?{connect:async()=>{stream=await provider.openDesktopStream(device.deviceId);return connectDesktop(ticket,{host:'127.0.0.1',expectedHostIdentity:'ipc-fixture',stream});}}:{}),close:()=>service.close(owner,ticket.id)};},publish:e=>{if(e.type==='frame'){stats.frames++;stats.frameTimes.push(Date.now());}if(e.type==='state')stats.states.push(e.state);if(e.type==='closed')stats.closed.push(e.reason);win.webContents.send('desktop:view-event',e);}});
 ipcMain.handle('desktop:view-start',(_,input)=>views.start(input));ipcMain.handle('desktop:view-stop',(_,id)=>views.stop(id));ipcMain.handle('desktop:view-release',(_,id,g)=>views.release(id,g));ipcMain.handle('desktop:view-quality',(_,id,q,g)=>views.quality(id,q,g));ipcMain.handle('desktop:view-input',()=>{throw Error('No real input permitted in fixture');});ipcMain.handle('desktop:view-ack',(_,id,seq,ok,ms,g)=>{if(ok)stats.decoded++;else stats.nack++;stats.decodeMs.push(ms);return views.ack(id,seq,ok,ms,g);});
 globalThis.fixture={stats,diagnostics,disconnect:()=>stream?.destroy(),shutdown:async()=>{await views.dispose();await service.shutdown();provider?.dispose();await server?.stop();await relay?.stop();}};
 await win.loadFile(${JSON.stringify(join(directory,'index.html'))});
 for(const display of screen.getAllDisplays()){
  const marker=new BrowserWindow({show:false,x:display.bounds.x+20,y:display.bounds.y+20,width:220,height:120,frame:false,focusable:false,skipTaskbar:true,alwaysOnTop:true,webPreferences:{backgroundThrottling:false,sandbox:true}});
  await marker.loadURL('data:text/html,'+encodeURIComponent('<body style="margin:0;background:#102b32;color:white;font:12px sans-serif">CAgent capture test<div id="box" style="width:50px;height:60px;background:#36e3b1"></div><script>let n=0;setInterval(()=>{document.getElementById("box").style.transform="translateX("+(n++%150)+"px)"},33)</script>'));marker.showInactive();
 }
});app.on('window-all-closed',()=>app.quit());`;
await build({stdin:{contents:main,resolveDir:process.cwd(),loader:'ts'},platform:'node',bundle:true,external:['electron'],outfile:join(directory,'main.cjs')});
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const instance=await electron.launch({args:[join(directory,'main.cjs')],env});
try{
 const page=await instance.firstWindow();page.setDefaultTimeout(20000);
 await page.getByRole('button',{name:'连接桌面',exact:true}).click();
 await page.waitForFunction(()=>{const c=document.querySelector('canvas');return !!c&&c.width>1;});
 const started=Date.now();
 if(reconnect){await new Promise(r=>setTimeout(r,2500));await instance.evaluate(()=>(globalThis as any).fixture.disconnect());const until=Date.now()+15000;while(Date.now()<until){if(await instance.evaluate(()=>(globalThis as any).fixture.stats.states.filter((s:string)=>s==='connected').length>=2))break;await new Promise(r=>setTimeout(r,100));}assert.ok(await instance.evaluate(()=>(globalThis as any).fixture.stats.states.filter((s:string)=>s==='connected').length>=2),'reconnect within deadline');}
 await new Promise(r=>setTimeout(r,15000));
 const report=await instance.evaluate(()=>{const f=(globalThis as any).fixture;return {stats:f.stats,diagnostics:f.diagnostics,versions:process.versions};});
 assert.deepEqual(report.stats.closed,[],'no automatic disconnect');
 if(reconnect)assert.ok(report.stats.states.includes('reconnecting')&&report.stats.states.filter((s:string)=>s==='connected').length>=2,'fresh connection after forced socket loss');
 const recent=report.stats.frameTimes.filter((t:number)=>t>Date.now()-2500).length;
 assert.ok(recent>1,'moving desktop must continue updating');assert.ok(report.stats.decoded>10,'must decode multiple frames');
 await page.getByRole('button',{name:'断开',exact:true}).click();
 const {frameTimes,decodeMs,...stats}=report.stats;
 const sorted=decodeMs.sort((a:number,b:number)=>a-b);
 const evidence={ok:true,observedMs:Date.now()-started,stats,framesInLast2500ms:recent,decodeMsP50:sorted[Math.floor(sorted.length*.5)],decodeMsP95:sorted[Math.floor(sorted.length*.95)],diagnostics:report.diagnostics,versions:report.versions,transport:'actual Electron IPC/preload, native capture and encrypted loopback',inputInjected:false,pixelsPersisted:false,publicNetworkTested:false};
 await writeFile(evidenceFile,JSON.stringify({...evidence,managed,relayed,reconnect},null,2));console.log(JSON.stringify({...evidence,managed,relayed,reconnect}));
}catch(error){const detail=await instance.evaluate(()=>(globalThis as any).fixture?.stats).catch(()=>undefined);await writeFile(evidenceFile,JSON.stringify({ok:false,error:String(error),detail},null,2));throw error;}
finally{await instance.evaluate(async()=>{await(globalThis as any).fixture?.shutdown();}).catch(()=>{});await instance.close();await rm(directory,{recursive:true,force:true});}
