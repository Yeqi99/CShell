import {build} from 'esbuild';import {_electron as electron} from 'playwright';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import assert from 'node:assert/strict';
const dir=await mkdtemp(join(tmpdir(),'cshell-look-ui-')),id='11111111-1111-4111-8111-111111111111';
await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{LinuxDesktop}from'./src/ui/components/LinuxDesktop';import './src/ui/theme.css';import './src/ui/styles.css';const machine={deviceId:'${id}',platform:'android'};createRoot(document.getElementById('root')).render(<LinuxDesktop name="隔离外观验证" machine={machine} target="fixture" call={async()=>machine} active/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,jsx:'automatic',outfile:join(dir,'fixture.js')});
await writeFile(join(dir,'index.html'),'<html data-theme="light"><head><link rel="stylesheet" href="fixture.css"></head><body style="margin:0"><div id="root" style="height:100vh"></div><script src="fixture.js"></script></body></html>');
await writeFile(join(dir,'preload.cjs'),`const{contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('cshell',{desktopLookGet:(...a)=>ipcRenderer.invoke('get',...a),desktopLookSave:(...a)=>ipcRenderer.invoke('save',...a),onDesktopLookChanged:fn=>{ipcRenderer.on('changed',fn);return()=>ipcRenderer.removeListener('changed',fn)},testSnapshot:()=>ipcRenderer.invoke('snapshot')});`);
await build({stdin:{contents:`import{app,BrowserWindow,ipcMain,safeStorage}from'electron';import{DesktopLooks}from'./src/core/desktop-looks';app.setPath('userData',${JSON.stringify(join(dir,'data'))});app.whenReady().then(async()=>{const w=new BrowserWindow({width:1100,height:800,show:false,webPreferences:{sandbox:true,contextIsolation:true,preload:${JSON.stringify(join(dir,'preload.cjs'))}}});const s=new DesktopLooks(app.getPath('userData'),{encryptPrivate:async v=>safeStorage.encryptString(v).toString('base64'),decryptPrivate:async v=>safeStorage.decryptString(Buffer.from(v,'base64'))},()=>w.webContents.send('changed'));await s.load();globalThis.resetFixture=()=>s.cloudImport(undefined,true);ipcMain.handle('get',async(e,...a)=>{if(globalThis.failRead)throw Error('fixture read failure');const v=await s.get(...a);await new Promise(r=>setTimeout(r,120));return v;});ipcMain.handle('save',async(e,...a)=>{await new Promise(r=>setTimeout(r,20));return s.save(...a);});ipcMain.handle('snapshot',()=>s.cloudExport());w.loadFile(${JSON.stringify(join(dir,'index.html'))});});`,resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',external:['electron'],outfile:join(dir,'main.cjs')});
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
let app:Awaited<ReturnType<typeof electron.launch>>|undefined;
const start=async()=>{app=await electron.launch({args:[join(dir,'main.cjs')],env});const page=await app.firstWindow();page.setDefaultTimeout(15000);await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].showInactive());await page.locator('[data-desktop-icon="settings"]').dblclick();await page.getByLabel('方案名称',{exact:true}).waitFor();await page.waitForTimeout(250);return page;};
try{
 let page=await start();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const name=page.getByLabel('方案名称',{exact:true});await name.fill('');await name.pressSequentially('我的持久方案123',{delay:25});await page.waitForTimeout(600);assert.equal(await name.inputValue(),'我的持久方案123');
 for(const wall of ['dusk','forest','ink'])await page.getByRole('button',{name:'背景 '+wall,exact:true}).click();
 await page.waitForTimeout(500);assert.equal(await page.getByRole('button',{name:'背景 ink',exact:true}).getAttribute('aria-pressed'),'true');
 await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/desktop-look-edited.png'});
 await page.locator('#root').evaluate(e=>{(e as HTMLElement).style.containerType='inline-size';(e as HTMLElement).style.containerName='workspace';});
 for(const width of [390,340]){
  await app!.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setContentSize(width,800),width);await page.waitForTimeout(250);
  await page.getByLabel('方案名称',{exact:true}).scrollIntoViewIfNeeded();
  const measured=await page.locator('.desktop-look-name').evaluate(e=>{const label=e.querySelector('span')!.getBoundingClientRect(),input=e.querySelector('input')!.getBoundingClientRect();return{labelHeight:label.height,inputRight:input.right,viewport:innerWidth};});
  assert.ok(measured.labelHeight<30&&measured.inputRight<=measured.viewport,JSON.stringify(measured));
  const footer=await page.locator('.desktop-look-footer').evaluate(e=>{const button=e.querySelector('button')!.getBoundingClientRect(),note=e.querySelector('small')!.getBoundingClientRect();return{bottom:button.bottom,top:note.top};});assert.ok(footer.top>=footer.bottom);
  await page.screenshot({path:'test-results/desktop-look-'+width+'.png'});
 }
 await app!.close();page=await start();assert.equal(await page.getByLabel('方案名称',{exact:true}).inputValue(),'我的持久方案123');assert.equal(await page.getByRole('button',{name:'背景 ink',exact:true}).getAttribute('aria-pressed'),'true');
 await page.addInitScript(()=>{Storage.prototype.setItem=function(){throw new DOMException('quota','QuotaExceededError');};});
 await page.reload();await page.locator('[data-desktop-icon="settings"]').dblclick();await page.waitForTimeout(350);
 await page.getByLabel('方案名称',{exact:true}).fill('配额失败仍可编辑');await page.waitForTimeout(400);assert.equal(await page.getByLabel('方案名称',{exact:true}).inputValue(),'配额失败仍可编辑');
 await page.getByRole('button',{name:'恢复默认外观',exact:true}).click();await page.waitForTimeout(350);assert.equal((await page.evaluate(()=> (window.cshell as any).testSnapshot())).looks[id],null);
 await app!.evaluate(async()=>{await (globalThis as any).resetFixture();});
 // Clear only this fixture's encrypted store so malformed legacy migration is exercised.
 // use another stable machine id to exercise a corrupt legacy value without touching an account.
 await app!.close();
 await writeFile(join(dir,'index.html'),'<html data-theme="light"><head><link rel="stylesheet" href="fixture.css"></head><body style="margin:0"><div id="root" style="height:100vh"></div><script>localStorage.setItem("cshell-linux-desktop:'+id+'",JSON.stringify({name:"broken",theme:"light",wallpaper:"coast",image:"data:image/png;base64,SGVsbG8gd29ybGQh"}));Storage.prototype.setItem=function(){throw new DOMException("quota","QuotaExceededError")};</script><script src="fixture.js"></script></body></html>');
 // Malformed legacy migration must retry without legacy; then force a backend read
 // failure and verify the explicit retry restores editing.
 page=await start();assert.equal(await page.getByLabel('方案名称',{exact:true}).inputValue(),'海岸');
 await app!.evaluate(()=>{(globalThis as any).failRead=true;});await page.reload();await page.locator('[data-desktop-icon="settings"]').dblclick();await page.getByRole('button',{name:'重新读取外观',exact:true}).waitFor();
 await app!.evaluate(()=>{(globalThis as any).failRead=false;});await page.getByRole('button',{name:'重新读取外观',exact:true}).click();await page.waitForTimeout(400);await page.getByLabel('方案名称',{exact:true}).fill('重试恢复');await page.waitForTimeout(400);assert.equal((await page.evaluate(()=> (window.cshell as any).testSnapshot())).looks[id].name,'重试恢复');
 await page.screenshot({path:'test-results/desktop-look-recovery.png'});assert.deepEqual(errors,[]);
 console.log('PASS isolated Electron desktop Look: typing/read races, rapid wallpaper changes, encrypted restart persistence, reset tombstone, quota and explicit read retry. No user data or remote machine.');
}finally{await app?.close().catch(()=>{});await rm(dir,{recursive:true,force:true});}
