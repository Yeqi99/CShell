import {build} from 'esbuild';
import {_electron as electron} from 'playwright';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const dir=await mkdtemp(join(tmpdir(),'cshell-fullscreen-'));
await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{AgentDesktopView}from'./src/ui/components/AgentDesktopView';window.cshell={onDesktopViewEvent:()=>()=>{},desktopViewStop:async()=>{},desktopViewRelease:async()=>{}};createRoot(document.getElementById('root')).render(<AgentDesktopView target="fixture" canView={true} canControl={false}/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,jsx:'automatic',outfile:join(dir,'fixture.js')});
await writeFile(join(dir,'index.html'),'<html><head><link rel="stylesheet" href="fixture.css"></head><body style="margin:0"><div id="root" style="margin:80px;height:500px"></div><script src="fixture.js"></script></body></html>');
await build({entryPoints:['src/desktop/window-permissions.ts'],bundle:true,platform:'node',format:'cjs',external:['electron'],outfile:join(dir,'permissions.cjs')});
await writeFile(join(dir,'main.cjs'),`const {app,BrowserWindow,session}=require('electron');const {pathToFileURL}=require('node:url');const {installWindowPermissions}=require('./permissions.cjs');app.setPath('userData',${JSON.stringify(join(dir,'data'))});app.whenReady().then(()=>{const w=new BrowserWindow({width:1000,height:760,show:true,titleBarStyle:'hidden',titleBarOverlay:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});const entry=pathToFileURL(${JSON.stringify(join(dir,'index.html'))}).href;installWindowPermissions(session.defaultSession,w.webContents,entry);w.loadURL(entry);});`);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({args:[join(dir,'main.cjs')],env});

try{
 const page=await app.firstWindow();
for(let i=0;i<2;i++){
  await page.getByRole('button',{name:'全屏',exact:true}).click();
  await page.waitForFunction(()=>!!document.fullscreenElement,undefined,{timeout:3000});
  await page.waitForTimeout(400);
  const box=await page.locator('.agent-desktop-view').boundingBox();const viewport=await page.evaluate(()=>({w:innerWidth,h:innerHeight}));
  assert.ok(box&&Math.abs(box.width-viewport.w)<2&&Math.abs(box.height-viewport.h)<2,JSON.stringify({box,viewport}));
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isFullScreen()),true);
  await page.getByRole('button',{name:'退出全屏',exact:true}).click();await page.waitForFunction(()=>!document.fullscreenElement);
 }
 await page.getByRole('button',{name:'填满工作区',exact:true}).click();
 await page.getByRole('button',{name:'全屏',exact:true}).click();await page.waitForFunction(()=>!!document.fullscreenElement,undefined,{timeout:3000});
 await page.waitForTimeout(400);await page.getByRole('button',{name:'退出全屏',exact:true}).focus();await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.fullscreenElement);
 assert.equal(await page.getByRole('button',{name:'还原工作区',exact:true}).getAttribute('aria-pressed'),'true');
 await page.getByRole('button',{name:'还原工作区',exact:true}).click();
 await writeFile('test-results/desktop-fullscreen-0.6.33.json',JSON.stringify({ok:true,nativeFullscreenVerified:true,repeatedEntryExit:true,escapeRestoresExpanded:true},null,2));console.log('PASS fullscreen');
}finally{await app.close();}
