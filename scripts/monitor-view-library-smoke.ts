import { _electron as electron } from 'playwright';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const data=await mkdtemp(join(tmpdir(),'cshell-view-library-'));
const env={...process.env,CSHELL_TEST_DATA:data};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({args:['.','--user-data-dir='+data],env});
try {
 const p=await app.firstWindow();p.setDefaultTimeout(12000);
 await p.waitForFunction(()=>!!window.cshell);
 const ids=await p.evaluate(async()=>{
 const profile={id:crypto.randomUUID(),protocol:'ssh' as const,name:'fixture',host:'127.0.0.1',port:1,username:'tester',group:'',favorite:false,auth:'password' as const}; await window.cshell.saveProfile(profile);
 const result=[]; for(let i=0;i<2;i++){const id=crypto.randomUUID();result.push(id);await window.cshell.saveMonitorView({id,name:'Twin',tiles:[{id:crypto.randomUUID(),profileId:profile.id,label:'fixture',kind:'ssh',displayId:(await window.cshell.viewDisplays())[0].id,column:0,row:0,width:12,height:12,directory:'',command:'',screen:''}]});}return result;});
 await p.getByRole('button',{name:'视图',exact:true}).first().click();
 const cards=p.locator('.view-library article');await cards.nth(1).waitFor();
 assert.equal(await p.getByRole('button',{name:'关闭 Twin 的窗口'}).count(),0);
 await cards.first().getByLabel('打开 Twin').click(); await cards.first().getByLabel('关闭 Twin 的窗口').click();
 assert.equal(await cards.count(),2);
 await cards.first().getByLabel('打开 Twin').click();await cards.first().getByLabel('关闭 Twin 的窗口').waitFor();
 const [opened]=await p.evaluate(()=>window.cshell.openMonitorViewIds());assert(ids.includes(opened));
 await cards.first().getByLabel('删除视图 Twin').click();await cards.first().getByText('取消',{exact:true}).click();
 await cards.first().getByLabel('删除视图 Twin').click();await cards.first().getByText('确认删除').click();
 await cards.nth(1).waitFor({state:'detached'});assert.deepEqual(await p.evaluate(()=>window.cshell.openMonitorViewIds()),[]);
 assert.deepEqual(await p.evaluate(async()=>(await window.cshell.monitorViews()).map(v=>v.id)),ids.filter(i=>i!==opened));
 console.log('PASS: close preserves layout; cancel preserves both; confirmed deletion closes only its own window and preserves its namesake.');
}finally{await app.close();await rm(data,{recursive:true,force:true,maxRetries:3,retryDelay:200});}
