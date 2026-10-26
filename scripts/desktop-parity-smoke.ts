import {build} from 'esbuild';
import {_electron as electron} from 'playwright';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const dir=await mkdtemp(join(tmpdir(),'cshell-parity-'));
await mkdir('test-results',{recursive:true});
await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{WorkbenchHome}from'./src/ui/components/WorkbenchHome';import{LinuxDesktop}from'./src/ui/components/LinuxDesktop';import './src/ui/theme.css';import './src/ui/styles.css';window.cshell={monitorViews:async()=>[]};const props={config:{profiles:[],preferences:{workbenchView:'visual'}},active:true,currentCount:0,onNew:()=>{},onViews:()=>{},onConnect:()=>{},onCurrent:async()=>{},onView:async()=>{},onSettings:()=>{window.settingsOpened=true},onExtensions:()=>{},onAgent:()=>{},onCommandTab:()=>{}};createRoot(document.getElementById('root')).render(location.hash==='#machine'?<LinuxDesktop name="测试机器" machine={{deviceId:'fixture',sshOnly:true}} target="fixture" call={async()=>{throw Error('Unexpected remote call')}} active files={<textarea aria-label="文件草稿"/>} terminal={()=> <textarea aria-label="终端草稿"/>}/>:<WorkbenchHome {...props}/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,jsx:'automatic',outfile:join(dir,'fixture.js')});
await writeFile(join(dir,'index.html'),'<html data-theme="light"><head><link rel="stylesheet" href="fixture.css"></head><body style="margin:0"><div id="root" style="height:100vh;width:100vw"></div><script src="fixture.js"></script></body></html>');
await writeFile(join(dir,'main.cjs'),`const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(join(dir,'data'))});app.whenReady().then(()=>{new BrowserWindow({width:1000,height:700,useContentSize:true,show:false,webPreferences:{sandbox:true}}).loadFile(${JSON.stringify(join(dir,'index.html'))});});`);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({args:[join(dir,'main.cjs')],env});
try{
 const page=await app.firstWindow();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].showInactive());
 for(const machine of [false,true]){
  if(machine) {await page.evaluate(()=>{location.hash='machine';location.reload()});}
  await page.locator('.desktop-icons button').first().waitFor();
  const icon=page.locator(`[data-desktop-icon="${machine?'terminal':'connections'}"]`);
  await icon.click();assert.equal(await icon.getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('.desktop-window:visible').count(),0);
  assert.equal(await icon.evaluate(e=>getComputedStyle(e.lastElementChild!).userSelect),'none');
  // A real pointer rectangle selects icons without opening them or selecting text.
  const box=await icon.boundingBox();assert.ok(box);
  await page.mouse.move(box.x+box.width+5,box.y+box.height+5);await page.mouse.down();
  await page.mouse.move(box.x-5,box.y-5,{steps:8});await page.mouse.up();
  assert.equal(await icon.getAttribute('aria-pressed'),'true');
  assert.equal(await page.evaluate(()=>getSelection()?.toString()),'');
  await icon.dblclick();await page.locator('.desktop-window:visible').waitFor();
  const label=machine?'终端':'连接与视图';
  const before=await page.locator('.desktop-window:visible').boundingBox();assert.ok(before);
  await page.mouse.move(before.x+90,before.y+15);await page.mouse.down();
  await page.mouse.move(before.x+115,before.y+35,{steps:5});await page.mouse.up();
  const moved=await page.locator('.desktop-window:visible').boundingBox();assert.ok(moved&&moved.x>before.x&&moved.y>before.y);
  await page.getByRole('button',{name:'最大化'+label,exact:true}).click();
  assert.equal(await page.locator('.desktop-window.maximized:visible').count(),1);
  await page.getByRole('button',{name:'还原'+label,exact:true}).click();
  assert.equal(await page.locator('.desktop-window.maximized:visible').count(),0);
  if(machine) await page.getByLabel('终端草稿').fill('keep draft');
  await page.getByRole('button',{name:'显示桌面',exact:true}).click();
  assert.equal(await page.locator('.desktop-window:visible').count(),0);
  await icon.press('Enter');await page.locator('.desktop-window:visible').waitFor();
  if(machine)assert.equal(await page.getByLabel('终端草稿').inputValue(),'keep draft');
  await page.getByRole('button',{name:'显示桌面',exact:true}).click();
  for(const [width,height] of [[1000,700],[500,330],[280,290],[1000,700]]){
   await app.evaluate(({BrowserWindow},s)=>BrowserWindow.getAllWindows()[0].setContentSize(s[0],s[1]),[width,height]);await page.waitForTimeout(100);
   const layout=await page.locator('.desktop-icons').evaluate(e=>({rows:getComputedStyle(e).gridTemplateRows,height:e.clientHeight,scroll:e.scrollHeight,width:e.clientWidth,scrollWidth:e.scrollWidth}));
   assert.ok(layout.height>0&&layout.width>0,JSON.stringify(layout));
   const last=page.locator('.desktop-icons button').last();await last.scrollIntoViewIfNeeded();
   const b=await last.boundingBox();assert.ok(b&&b.x>=0&&b.x+b.width<=width+1&&b.y+b.height<=height,JSON.stringify(b));
   if(height===330)assert.ok(layout.rows.split(' ').length<5,JSON.stringify(layout));
  }
  await page.screenshot({path:'test-results/desktop-parity-'+(machine?'machine':'workbench')+'.png'});
 }
 assert.deepEqual(errors,[]);console.log('PASS both desktops: selection, rectangle, no text selection, double-click/Enter, minimize/restore and draft retention; responsive 1000/500/280 widths and 700/330/290 heights. Isolated Electron fixture.');
}finally{await app.close();await rm(dir,{recursive:true,force:true});}
