import {build} from 'esbuild';
import {_electron as electron} from 'playwright';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const dir=await mkdtemp(join(tmpdir(),'cshell-fullscreen-'));
await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{AgentDesktopView}from'./src/ui/components/AgentDesktopView';window.cshell={onDesktopViewEvent:()=>()=>{},desktopViewStop:async()=>{},desktopViewRelease:async()=>{}};window.fullscreenTrace=[];document.addEventListener('fullscreenchange',()=>window.fullscreenTrace.push({event:'fullscreenchange',active:!!document.fullscreenElement,at:performance.now()}));document.addEventListener('click',event=>window.fullscreenTrace.push({event:'click',button:event.target.closest('button')?.getAttribute('aria-label'),active:!!document.fullscreenElement,at:performance.now()}),true);createRoot(document.getElementById('root')).render(<AgentDesktopView target="fixture" canView={true} canControl={false}/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,jsx:'automatic',outfile:join(dir,'fixture.js')});
await writeFile(join(dir,'index.html'),'<html><head><link rel="stylesheet" href="fixture.css"></head><body style="margin:0"><div id="root" style="margin:80px;height:500px"></div><script src="fixture.js"></script></body></html>');
await build({entryPoints:['src/desktop/window-permissions.ts'],bundle:true,platform:'node',format:'cjs',external:['electron'],outfile:join(dir,'permissions.cjs')});
await writeFile(join(dir,'main.cjs'),`const {app,BrowserWindow,session}=require('electron');const {pathToFileURL}=require('node:url');const {installWindowPermissions}=require('./permissions.cjs');app.setPath('userData',${JSON.stringify(join(dir,'data'))});global.fullscreenTransitions={entered:0,left:0,events:[]};app.whenReady().then(()=>{const w=new BrowserWindow({width:1000,height:760,show:true,titleBarStyle:'hidden',titleBarOverlay:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});for(const name of ['enter-full-screen','leave-full-screen','enter-html-full-screen','leave-html-full-screen'])w.on(name,()=>{if(name==='enter-full-screen')global.fullscreenTransitions.entered++;if(name==='leave-full-screen')global.fullscreenTransitions.left++;global.fullscreenTransitions.events.push({event:name,at:Date.now(),native:w.isFullScreen()});});const entry=pathToFileURL(${JSON.stringify(join(dir,'index.html'))}).href;installWindowPermissions(session.defaultSession,w.webContents,entry);w.loadURL(entry);});`);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({args:[join(dir,'main.cjs')],env});

// DOM fullscreen and the macOS native Space transition complete independently.
// Observe native completion on both entry and exit before starting another cycle.
let enteredTransitions=0,leftTransitions=0;
async function nativeFullscreen(expected:boolean){
 const minimum=expected?++enteredTransitions:++leftTransitions;
 const deadline=Date.now()+15000;
 while(true){
  const state=await app.evaluate(({BrowserWindow})=>({native:BrowserWindow.getAllWindows()[0].isFullScreen(),...(globalThis as any).fullscreenTransitions}));
  if(state.native===expected&&(expected?state.entered:state.left)>=minimum)break;
  assert.ok(Date.now()<deadline,`Native fullscreen transition ${minimum} did not complete: ${JSON.stringify({expected,...state})}`);
  await new Promise(resolve=>setTimeout(resolve,50));
 }
 assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isFullScreen()),expected);
}

try{
 const page=await app.firstWindow();
 const entered=async()=>{
  await page.waitForFunction(()=>!!document.fullscreenElement);
  await nativeFullscreen(true);
  await page.waitForFunction(()=>{
   const box=document.fullscreenElement?.getBoundingClientRect();
   return box&&Math.abs(box.x)<2&&Math.abs(box.y)<2&&Math.abs(box.width-innerWidth)<2&&Math.abs(box.height-innerHeight)<2;
  },undefined,{timeout:15000});
  const box=await page.locator('.agent-desktop-view').boundingBox();const viewport=await page.evaluate(()=>({w:innerWidth,h:innerHeight}));
  assert.ok(box&&Math.abs(box.x)<2&&Math.abs(box.y)<2&&Math.abs(box.width-viewport.w)<2&&Math.abs(box.height-viewport.h)<2,JSON.stringify({box,viewport}));
 };
 const exited=async()=>{await page.waitForFunction(()=>!document.fullscreenElement);await nativeFullscreen(false);};
for(let i=0;i<2;i++){
  await page.getByRole('button',{name:'全屏',exact:true}).click();
  await entered();
  await page.getByRole('button',{name:'退出全屏',exact:true}).click();await exited();
 }
 await page.getByRole('button',{name:'填满工作区',exact:true}).click();
 await page.getByRole('button',{name:'全屏',exact:true}).click();await entered();
 await page.getByRole('button',{name:'退出全屏',exact:true}).focus();await page.keyboard.press('Escape');await exited();
 assert.equal(await page.getByRole('button',{name:'还原工作区',exact:true}).getAttribute('aria-pressed'),'true');
 await page.getByRole('button',{name:'还原工作区',exact:true}).click();
 await writeFile('test-results/desktop-fullscreen-0.6.33.json',JSON.stringify({ok:true,nativeFullscreenVerified:true,nativeCompletionEventsVerified:true,repeatedEntryExit:true,escapeRestoresExpanded:true},null,2));console.log('PASS fullscreen');
}catch(error){
 const page=await app.firstWindow();
 console.error('Fullscreen failure state',JSON.stringify({native:await app.evaluate(({BrowserWindow})=>({native:BrowserWindow.getAllWindows()[0].isFullScreen(),...(globalThis as any).fullscreenTransitions})),renderer:await page.evaluate(()=>({active:!!document.fullscreenElement,trace:(window as any).fullscreenTrace,error:document.querySelector('.agent-desktop-view .form-error')?.textContent}))}));
 await page.screenshot({path:'test-results/desktop-fullscreen-failure.png'}).catch(()=>{});
 throw error;
}finally{await app.close();}

