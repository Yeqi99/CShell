import {_electron as electron} from 'playwright';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';import {fixture} from '../tests/fixture';
const data=await mkdtemp(join(tmpdir(),'cshell-020-package-ui-')),server=await fixture();
const env={...process.env,CSHELL_TEST_DATA:data,CSHELL_TEST_START_GATE:'1'};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:process.env.CSHELL_EXECUTABLE!,args:[],env});
await app.evaluate(()=>{(globalThis as any).__cshellPackagedTestAttached=true;});
const out='test-results/020-packaged-ui';await mkdir(out,{recursive:true});
try{
 const page=await app.firstWindow();page.setDefaultTimeout(15000);
 const identity=await app.evaluate(({app})=>({name:app.getName(),version:app.getVersion(),packaged:app.isPackaged,userData:app.getPath('userData')}));
 assert.equal(identity.version,'0.8.20');assert(identity.packaged);assert(identity.userData.startsWith(data));assert.equal(identity.name,process.env.CSHELL_EXPECT_NAME);
 await page.getByRole('heading',{name:'工作台',exact:true}).waitFor();
 await page.evaluate(async()=>{const c=await window.cshell.config();await window.cshell.preferences({...c.preferences,locale:'en-US',workbenchView:'visual'});});await page.reload();
 await page.locator('[data-desktop-icon="connections"]').waitFor();
 assert.equal((await page.locator('[data-desktop-icon="connections"]').innerText()).trim(),'Connections & views');
 assert.equal((await page.locator('[data-desktop-icon="preferences"]').innerText()).trim(),'Preferences');
 await page.locator('.linux-desktop').evaluate(el=>{(el as HTMLElement).style.width='320px';});
 const ping=page.getByRole('button',{name:'Ping all servers from this device',exact:true});assert.equal((await ping.innerText()).trim(),'');
 await ping.click({button:'right'});const menu=page.getByRole('dialog',{name:'Automatic ping settings'});await menu.waitFor();const box=await menu.boundingBox(),width=await page.evaluate(()=>innerWidth);assert(box&&box.x>=0&&box.x+box.width<=width);assert.equal(await ping.getAttribute('title'),null);
 await page.screenshot({path:join(out,identity.name+'-english.png')});await page.keyboard.press('Escape');
 await page.evaluate(async()=>{const c=await window.cshell.config();await window.cshell.preferences({...c.preferences,locale:'zh-CN',workbenchView:'overview'});});await page.reload();
 // Controlled inspector results exercise the actual packaged renderer. SSH and
 // PTY remain real local fixtures; this does not claim a physical Linux probe.
 await app.evaluate(({ipcMain,dialog})=>{dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});ipcMain.removeHandler('native-desktop:setup');ipcMain.handle('native-desktop:setup',()=>{(globalThis as any).inspectCount++;return {desktopPresence:(globalThis as any).desktopPresence,sessions:[],running:false};});});
 for(const state of ['absent','unknown','present']){
  await app.evaluate((_,s)=>{(globalThis as any).desktopPresence=s;(globalThis as any).inspectCount=0;},state);
  await page.getByRole('button',{name:'新建连接',exact:true}).first().click();await page.getByRole('button',{name:'SSH 终端',exact:true}).click();
  const form=page.locator('.connection-editor:visible');await form.getByLabel('保存到服务器列表').uncheck();await form.getByLabel('主机地址',{exact:true}).fill('127.0.0.1');await form.getByLabel('端口',{exact:true}).fill(String(server.port));await form.getByLabel('用户名',{exact:true}).fill('tester');await form.locator('.connection-secret input').fill(server.password);await form.getByRole('button',{name:'连接',exact:true}).click();await page.locator('.terminals:visible .xterm-helper-textarea:visible').waitFor();
  await page.getByLabel('桌面与显示方式',{exact:true}).click();await page.getByRole('menuitem',{name:'CShell 可视化桌面',exact:true}).click();
  await page.locator('.linux-desktop:visible').waitFor();for(let i=0;i<100&&!(await app.evaluate(()=>(globalThis as any).inspectCount));i++)await page.waitForTimeout(20);
  assert(await app.evaluate(()=>(globalThis as any).inspectCount)>0);await page.waitForTimeout(150);
  assert.equal(await page.locator('.linux-desktop:visible [data-desktop-icon="native-desktop"]').count(),state==='present'?1:0,state);
 }
 await page.screenshot({path:join(out,identity.name+'-desktop-present.png')});
 await writeFile(join(out,identity.name+'.json'),JSON.stringify({...identity,userData:'isolated-temporary-directory',checks:['English built-in names','320px desktop','icon-only Ping bounded menu','native absent/unknown hidden; present visible'],inspector:'controlled IPC fixture; real SSH/PT Y'},null,2));
 console.log('PASS packaged version/edition, isolated data, English desktop/Ping and native desktop visibility:',identity.name);
}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});await server.close();await rm(data,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
