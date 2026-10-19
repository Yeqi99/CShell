import {build} from 'esbuild';
import {_electron as electron} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
import {DesktopService} from '../src/agent/desktop-service';
import {NativeDesktop} from '../src/agent/desktop-native';
import {connectDesktop} from '../src/core/desktop-client';
import {DesktopViews} from '../src/core/desktop-views';
// Real native capture and transport in a hidden, isolated Electron window. Never inject input.
const dir=await mkdtemp(join(tmpdir(),'cagent-desktop-view-'));
await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{AgentDesktopView}from'./src/ui/components/AgentDesktopView';window.cshell={desktopViewStart:x=>window.rpc('start',x),desktopViewStop:id=>window.rpc('stop',id),desktopViewInput:()=>Promise.reject(Error('fixture forbids input')),desktopViewRelease:id=>window.rpc('release',id),desktopViewAck:(...x)=>window.rpc('ack',...x),desktopViewQuality:(...x)=>window.rpc('quality',...x),onDesktopViewEvent:fn=>{window.receive=e=>fn(e.type==='frame'?{...e,data:new Uint8Array(e.data)}:e);return()=>{window.receive=()=>{}};}};createRoot(document.getElementById('root')).render(<AgentDesktopView target="local" canView={true} canControl={false}/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,jsx:'automatic',outfile:join(dir,'fixture.js')});
const http=createServer(async(req,res)=>{const file=req.url==='/fixture.js'?'fixture.js':req.url==='/fixture.css'?'fixture.css':undefined;res.setHeader('Content-Type',file?.endsWith('.js')?'text/javascript':file?'text/css':'text/html');res.end(file?await readFile(join(dir,file)):'<html><head><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');});
await new Promise<void>(r=>http.listen(0,'127.0.0.1',r));
const entry=join(dir,'electron-fixture.cjs');
const animation='<body style="margin:0;background:#102b32;color:white;font:12px sans-serif">CAgent capture test<div id="box" style="width:50px;height:60px;background:#36e3b1"></div><script>window.ticks=0;let n=0;setInterval(()=>{document.getElementById("box").style.transform="translateX("+(n++%160)+"px)";window.ticks++;},33)</script>';
await writeFile(entry,`const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(join(dir,'user-data'))});app.whenReady().then(()=>{const win=new BrowserWindow({show:false,width:1000,height:760,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});win.loadURL('about:blank');const marker=new BrowserWindow({show:false,width:220,height:120,x:20,y:20,frame:false,focusable:false,skipTaskbar:true,alwaysOnTop:true,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});marker.loadURL(${JSON.stringify('data:text/html,'+encodeURIComponent(animation))});marker.webContents.once('did-finish-load',()=>marker.showInactive());});app.on('window-all-closed',()=>app.quit());`);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({args:[entry],env});
await app.firstWindow();for(let n=0;n<100&&app.windows().length<2;n++)await new Promise(r=>setTimeout(r,50));
const page=app.windows().find(p=>p.url()==='about:blank');if(!page)throw new Error('Missing viewer fixture window');
const versions=await app.evaluate(()=>process.versions);
const nativeStats:any[]=[];let receiver:any;let receivedFrames=0,nacks=0;const diagnostics:{stage:string;message:string}[]=[];const service=new DesktopService({identity:'ui-fixture',nativeExecutable:resolve('release/0.6.26/agent-win32-x64/cagent-desktop.exe'),authorize:()=>true,captureFactory:()=>{const c=new NativeDesktop(resolve('test-results/cagent-desktop-native.exe'));c.on('frame',f=>nativeStats.push({at:Date.now(),bytes:f.data.length,key:f.key,captureUs:f.captureUs,convertUs:f.convertUs,encodeUs:f.encodeUs}));return c;},diagnostic:e=>{diagnostics.push(e);console.log('HOST',e);}});
let frames=0,decoded=0,viewId='';const decodeTimes:number[]=[];
const manager=new DesktopViews({connect:async(...args)=>{receiver=await connectDesktop(...args);receiver.on('frame',()=>receivedFrames++);return receiver;},authorize:()=>{},open:async input=>({ticket:service.open('local',{control:false,quality:input.quality}),host:'127.0.0.1',identity:'ui-fixture',local:true,close:async()=>{}}),publish:e=>{viewId=e.id;if(e.type==='frame')frames++;else console.log(e);void page.evaluate(event=>(window as any).receive?.(event),e.type==='frame'?{...e,data:Array.from(e.data)}:e).catch(()=>{});}});
try{
 // Dedicated unused local test ports; no firewall or persistent configuration.
 await service.configure({enabled:true,bindAddress:'127.0.0.1',tcpPort:39128,udpPort:39129,local:{view:true,control:false}});
 await page.exposeFunction('rpc',async(method:string,...args:any[])=>{if(method==='ack'&&!args[2])nacks++;if(method==='ack'&&args[2]){decoded++;decodeTimes.push(Date.now());}return (manager as any)[method](...args);});
 const errors:string[]=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});page.setDefaultTimeout(10000);
 await page.goto(`http://127.0.0.1:${(http.address() as any).port}`);
 assert.equal(await page.getByLabel('控制键鼠',{exact:true}).isDisabled(),true);
 await page.getByRole('button',{name:'画质',exact:true}).click();await page.getByLabel('目标帧率',{exact:true}).fill('15');await page.getByLabel('目标码率（Mbps）',{exact:true}).fill('2');await page.getByLabel('目标宽度',{exact:true}).fill('1000');await page.getByLabel('目标高度',{exact:true}).fill('600');await page.getByLabel('根据网络自动调整',{exact:true}).uncheck();await page.getByRole('button',{name:'画质',exact:true}).click();await page.getByRole('button',{name:'连接桌面',exact:true}).click();
 await page.waitForFunction(()=>{const c=document.querySelector('canvas');return !!c&&c.width>1&&c.height>1;},undefined,{timeout:20000,polling:100});
 const size=await page.locator('canvas').evaluate(c=>({width:(c as HTMLCanvasElement).width,height:(c as HTMLCanvasElement).height}));
 console.log('decoded canvas',size);console.log('applying quality');await page.getByRole('button',{name:'画质',exact:true}).click();await page.getByLabel('目标帧率',{exact:true}).fill('20');await page.getByLabel('目标码率（Mbps）',{exact:true}).fill('3');await page.getByLabel('目标宽度',{exact:true}).fill('800');await page.getByLabel('目标高度',{exact:true}).fill('480');await page.getByLabel('根据网络自动调整',{exact:true}).uncheck();await page.getByRole('button',{name:'应用到当前连接',exact:true}).click();await page.waitForFunction(()=>document.querySelector('canvas')?.width===800,undefined,{polling:100,timeout:20000});manager.release(viewId);
 const observedMs=Number(process.env.DESKTOP_MOTION_MS||10000);
 if(process.env.DESKTOP_ADAPTIVE==='1'){await page.getByLabel('根据网络自动调整',{exact:true}).check();await page.getByRole('button',{name:'应用到当前连接',exact:true}).click();}
 const progress=[];for(let elapsed=0;elapsed<observedMs;elapsed+=5000){await new Promise(r=>setTimeout(r,Math.min(5000,observedMs-elapsed)));progress.push({elapsed:elapsed+5000,decoded});console.log('motion progress',progress.at(-1));assert.ok(decodeTimes.some(t=>t>Date.now()-5000),'no decoded frames for five seconds');}assert.equal(await page.getByRole('button',{name:'断开',exact:true}).count(),1,'unexpected automatic disconnection');const decodedInFinalTwoSeconds=decodeTimes.filter(t=>t>Date.now()-2000).length;assert.ok(decodedInFinalTwoSeconds>0,'no decoding in final two seconds');
 const marker=await app.evaluate(async({BrowserWindow,screen})=>({displays:screen.getAllDisplays().map(d=>({id:d.id,bounds:d.bounds})),windows:await Promise.all(BrowserWindow.getAllWindows().map(async w=>({bounds:w.getBounds(),visible:w.isVisible(),ticks:await w.webContents.executeJavaScript('window.ticks || 0')})))}));const transportStats=receiver?.session.mediaStats;
 await page.getByRole('button',{name:'断开',exact:true}).click();
 assert.equal(errors.length,0,errors.join('\n'));assert.ok(decoded>0);
 await writeFile('test-results/cagent-desktop-view-electron-ui.json',JSON.stringify({ok:true,frames,decoded,size,nativeStats,receivedFrames,nacks,transportStats,marker,diagnostics,observedMs,progress,adaptive:process.env.DESKTOP_ADAPTIVE==='1',maxDecodeGapMs:Math.max(0,...decodeTimes.slice(1).map((t,i)=>t-decodeTimes[i])),qualityRestartRequested:true,readOnlyReleaseRequested:true,motionFixture:true,decodedInFinalTwoSeconds,inputInjected:false,pixelsPersisted:false,publicNetworkTested:false,hiddenWindow:true,versions,renderer:'Electron WebCodecs component fixture'},null,2));
 console.log(JSON.stringify({ok:true,frames,decoded,size}));
}catch(error){await writeFile('test-results/cagent-desktop-view-electron-ui.json',JSON.stringify({ok:false,frames,decoded,nativeStats,receivedFrames,nacks,transportStats:receiver?.session.mediaStats,marker:await app.evaluate(async({BrowserWindow,screen})=>({displays:screen.getAllDisplays().map(d=>({id:d.id,bounds:d.bounds,scale:d.scaleFactor})),windows:await Promise.all(BrowserWindow.getAllWindows().map(async w=>({bounds:w.getBounds(),visible:w.isVisible(),ticks:await w.webContents.executeJavaScript('window.ticks || 0')})))})),diagnostics,error:String(error),versions,inputInjected:false,pixelsPersisted:false,publicNetworkTested:false,renderer:'Electron WebCodecs component fixture'},null,2));throw error;}
finally{await manager.dispose();await service.shutdown();await app.close();http.closeAllConnections();await new Promise<void>(r=>http.close(()=>r()));await rm(dir,{recursive:true,force:true});}


