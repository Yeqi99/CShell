import {_electron as electron} from 'playwright';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const data=await mkdtemp(join(tmpdir(),'cshell-rdp-saved-'));
const env={...process.env,CSHELL_TEST_DATA:data};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({args:['.'],env});
try{
 const p=await app.firstWindow();p.setDefaultTimeout(15000);
 await app.evaluate(({ipcMain,BrowserWindow})=>{
  BrowserWindow.getAllWindows()[0].setSize(1280,850);
  ipcMain.removeHandler('connection:rdp');ipcMain.handle('connection:rdp',(_e,id)=>{(globalThis as any).rdpOpened=id;});
 });
 await p.getByRole('button',{name:'新建连接',exact:true}).first().click();
 await p.getByRole('button',{name:'Windows 远程桌面',exact:true}).click();
 const form=p.locator('.rdp-connect-form');
 await form.getByLabel('主机地址',{exact:true}).fill('fixture.example');
 await form.getByLabel('账号',{exact:true}).fill('DOMAIN\\tester');
 await form.getByLabel('密码',{exact:true}).fill('fixture-secret-7391');
 await form.getByRole('button',{name:'保存',exact:true}).click();
 await form.getByRole('status').filter({hasText:'已保存到左侧连接列表'}).waitFor();
 const config=await p.evaluate(()=>window.cshell.config());const profile=config.profiles.find(x=>x.host==='fixture.example')!;
 assert.equal(profile.protocol,'rdp');assert(config.savedCredentials.includes(profile.id));
 assert(!(await readFile(join(data,'config.json'),'utf8')).includes('fixture-secret-7391'));
 await p.locator('.server-open').filter({hasText:'fixture.example'}).dblclick();
 assert.equal(config.preferences.defaultConnectionView,'original');
 await p.waitForFunction(()=>!!window.cshell);
 assert.equal(await app.evaluate(()=> (globalThis as any).rdpOpened),profile.id,'native default invokes the actual RDP launcher once');
 assert.equal(await p.locator('.linux-desktop:visible').count(),0);
 await app.evaluate(()=>{(globalThis as any).rdpOpened=undefined;});
 await p.getByRole('button',{name:'连接操作 · fixture.example',exact:true}).click();
 await p.getByRole('menuitem',{name:'打开可视化桌面',exact:true}).click();
 assert.equal(await app.evaluate(()=> (globalThis as any).rdpOpened),undefined);
 await p.locator('.linux-desktop:visible .desktop-icons').getByRole('button',{name:'远程桌面',exact:true}).dblclick();
 await p.getByRole('button',{name:'打开远程桌面',exact:true}).click();

 assert.equal(await app.evaluate(()=> (globalThis as any).rdpOpened),profile.id);
 await p.reload();await p.locator('.server-open').filter({hasText:'fixture.example'}).waitFor();
 await p.getByRole('button',{name:'连接操作 · fixture.example',exact:true}).click();
 await p.getByRole('menuitem',{name:'编辑连接',exact:true}).click();
 assert.equal(await p.locator('.rdp-connect-form').getByLabel('账号',{exact:true}).inputValue(),'DOMAIN\\tester');
 assert.equal(await p.locator('.rdp-connect-form').getByLabel('密码',{exact:true}).inputValue(),'');
 await p.screenshot({path:'test-results/rdp-saved.png'});
 console.log('PASS RDP save/reload/list/double-click routing/edit, encrypted password and no plaintext rehydration; system login not attempted');
}finally{await app.close();await rm(data,{recursive:true,force:true});}
