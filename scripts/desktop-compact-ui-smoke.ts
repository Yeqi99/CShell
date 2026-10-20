import {build} from 'esbuild';
import {_electron as electron} from 'playwright';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const dir=await mkdtemp(join(tmpdir(),'cshell-desktop-compact-'));
await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{AgentDesktopView}from'./src/ui/components/AgentDesktopView';import './src/ui/theme.css';import './src/ui/styles.css';window.cshell={desktopViewStart:async x=>{window.lastStart=x;return{id:x.id,control:true,generation:1}},desktopViewStop:async()=>{},desktopViewRelease:async()=>{},desktopViewQuality:async()=>{},onDesktopViewEvent:fn=>{window.receive=fn;return()=>{}}};createRoot(document.getElementById('root')).render(<AgentDesktopView target="isolated-fixture" canView canControl/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,jsx:'automatic',outfile:join(dir,'fixture.js')});
await writeFile(join(dir,'index.html'),'<html data-theme="light"><head><link rel="stylesheet" href="fixture.css"></head><body style="margin:0;overflow:hidden"><main class="minimal-mode" style="width:100vw;height:100vh"><div id="root" style="width:100%;height:100%"></div></main><script src="fixture.js"></script></body></html>');
await writeFile(join(dir,'main.cjs'),`const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(join(dir,'data'))});app.whenReady().then(()=>{const w=new BrowserWindow({width:840,height:540,useContentSize:true,show:false,webPreferences:{sandbox:true,contextIsolation:true}});w.loadFile(${JSON.stringify(join(dir,'index.html'))});});`);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({args:[join(dir,'main.cjs')],env});
try{
 const page=await app.firstWindow();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].showInactive());const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 assert.equal(await page.getByLabel('控制键鼠',{exact:true}).isChecked(),true);
 await page.getByRole('button',{name:'连接桌面',exact:true}).click();
 await page.getByRole('button',{name:'展开桌面工具',exact:true}).waitFor();
 assert.equal(await page.locator('.desktop-toolbar').isVisible(),false);
 const area=await page.locator('.desktop-screen').boundingBox();assert.ok(area&&area.height>=535&&area.width>=835,JSON.stringify(area));
 await page.screenshot({path:'test-results/desktop-compact-hidden.png'});
 await page.getByRole('button',{name:'展开桌面工具',exact:true}).click();
 const openedArea=await page.locator('.desktop-screen').boundingBox();assert.equal(openedArea?.height,area?.height);
 await page.getByRole('button',{name:'画质',exact:true}).click();
 for(const name of ['低','中','高','超高','无上限'])assert.equal(await page.getByRole('button',{name,exact:true}).isVisible(),true);
 await page.getByRole('button',{name:'无上限',exact:true}).click();assert.equal(await page.getByLabel('目标帧率',{exact:true}).isDisabled(),true);
 assert.equal(await page.locator('.desktop-presets button[aria-pressed=true]').textContent(),'无上限');await page.waitForTimeout(200);
 await page.screenshot({path:'test-results/desktop-compact-quality.png'});
 for(const width of [480,360]){
  await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setContentSize(width,440),width);
  await page.waitForTimeout(100);
  const result=await page.locator('.desktop-quality').evaluate(e=>({width:e.clientWidth,scroll:e.scrollWidth,left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right,viewport:innerWidth}));
  assert.ok(result.scroll<=result.width+1&&result.left>=0&&result.right<=result.viewport,JSON.stringify(result));
 }
 await page.screenshot({path:'test-results/desktop-compact-narrow.png'});
 await page.getByRole('button',{name:'收起桌面工具',exact:true}).click();
 await page.evaluate(()=>document.querySelector('main')!.className='monitor-screen');
 assert.equal(await page.locator('.desktop-toolbar').isVisible(),false);
 assert.equal(await page.getByRole('button',{name:'展开桌面工具',exact:true}).isVisible(),true);
 assert.deepEqual(errors,[]);
 console.log('PASS compact desktop: default control, hidden tools, overlay presets, 840/480/360px, monitor mode. Mock transport only; no remote input.');
}finally{await app.close();await rm(dir,{recursive:true,force:true});}
