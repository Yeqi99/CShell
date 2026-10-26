import {build} from 'esbuild';
import {_electron as electron} from 'playwright';
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const dir=await mkdtemp(join(tmpdir(),'cshell-discovery-ui-'));
await mkdir('test-results',{recursive:true});
await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{ClassroomDiscovery}from'./src/extensions/classroom/Discovery';import'./src/extensions/classroom/classroom.css';import'./src/ui/theme.css';import'./src/ui/styles.css';window.sent=0;window.added=0;const sources=[1,2].map(n=>({id:'id'+n,deviceId:'id'+n,name:'学生机'+n,room:'机房A',address:'192.168.10.'+n,port:24443,fingerprint:Array(32).fill('AB').join(':'),version:'0.8.10',lastSeen:Date.now()}));const api={status:async()=>({enabled:true,advertising:false,sources,error:null}),prepare:async ids=>({token:'test',expiresAt:Date.now()+120000,candidates:sources.filter(s=>ids.includes(s.id)),failures:[]}),confirm:async input=>{window.sent++;if(!input.confirmed||input.password!=='fixture-secret')throw Error('Wrong explicit confirmation');return{devices:sources.map(s=>({deviceId:s.id})),failures:[]}}};createRoot(document.getElementById('root')).render(<div className="classroom"><ClassroomDiscovery api={api} onAdded={()=>window.added++}/></div>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,jsx:'automatic',outfile:join(dir,'fixture.js')});
await writeFile(join(dir,'index.html'),'<html data-theme="light"><link rel="stylesheet" href="fixture.css"><body style="margin:0;padding:18px"><div id="root"></div><script src="fixture.js"></script></body></html>');
await writeFile(join(dir,'main.cjs'),`const{app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(join(dir,'data'))});app.whenReady().then(()=>{const w=new BrowserWindow({width:1050,height:850,show:false});w.loadFile(${JSON.stringify(join(dir,'index.html'))});});`);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
let app;
try{
 app=await electron.launch({args:[join(dir,'main.cjs')],env});const page=await app.firstWindow();
 await page.getByText('学生机1',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.sent),0);
 await page.getByRole('button',{name:'选择全部（最多64台）',exact:true}).click();
 await page.getByRole('button',{name:'检查所选 2 台身份',exact:true}).click();
 const submit=page.getByRole('button',{name:'认证并加入 2 台',exact:true});await submit.waitFor();assert(await submit.isDisabled());assert.equal(await page.evaluate(()=>window.sent),0);
 assert.equal(await page.getByLabel('本批设备密码').inputValue(),'');
 await page.setViewportSize({width:390,height:850});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'test-results/classroom-discovery-390.png'});
 await page.getByLabel('我已核对这 2 台机房设备的身份').check();await page.getByLabel('本批设备密码').fill('fixture-secret');await submit.click();
 await page.getByRole('status').filter({hasText:'2 台已加入连接列表'}).waitFor();assert.equal(await page.evaluate(()=>window.sent),1);assert.equal(await page.evaluate(()=>window.added),1);assert.equal(await page.getByLabel('本批设备密码').count(),0);
 console.log('PASS discovery UI: no auto-auth, multi-select, actual fingerprint stage, explicit checkbox+empty password, one-shot join, added callback, 390px no overflow. Synthetic backend only.');
}finally{if(app)await app.close();await rm(dir,{recursive:true,force:true,maxRetries:4,retryDelay:200});}
