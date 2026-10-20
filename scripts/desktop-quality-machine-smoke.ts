import {_electron as electron} from 'playwright';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {createAgentRuntime} from '../src/agent/runtime';
const data=await mkdtemp(join(tmpdir(),'machine-ui-')),runtime=await createAgentRuntime({directory:join(data,'agent')});
const holder=createServer().listen(0,'127.0.0.1');await once(holder,'listening');const port=(holder.address() as any).port;await new Promise<void>(r=>holder.close(()=>r()));
await runtime.dispatch('connection.save',{bind:'127.0.0.1',port,password:'fixture-password'});
const env={...process.env,CSHELL_TEST_DATA:join(data,'cshell')};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({args:['.'],env});
try{
 const page=await app.firstWindow();page.setDefaultTimeout(15000);console.log("window");await page.getByRole('heading',{name:'工作台',exact:true}).waitFor();
 await page.evaluate(async({port})=>{const info=await window.cshell.clientProbe({host:'127.0.0.1',port});const device=await window.cshell.clientPasswordPair(info,'fixture-password');await window.cshell.saveProfile({id:device.deviceId,protocol:'client',name:'机器工作区测试',host:device.host,port:device.port,username:'Client',auth:'password',favorite:false,group:''});},{port});
 console.log("paired");await runtime.dispatch('connection.save',{bind:'127.0.0.1',port,password:'fixture-password'});await page.reload();await page.getByText('机器工作区测试',{exact:true}).first().dblclick();
 const machine=page.locator('.agent-machine:visible');await machine.waitFor();console.log("machine");assert.equal(await machine.locator('.terminal-pane').count(),0);
 await machine.getByRole('button',{name:'远程桌面',exact:true}).click();await machine.getByRole('button',{name:'连接桌面',exact:true}).waitFor();
 await machine.getByRole('button',{name:'画质',exact:true}).click();await page.screenshot({path:'test-results/desktop-quality-machine.png'});const connect=await machine.getByRole('button',{name:'连接桌面',exact:true}).boundingBox();const panel=await machine.locator('.desktop-quality').boundingBox();assert.ok(connect!.y<panel!.y);await writeFile('test-results/desktop-quality-machine.json',JSON.stringify({passed:true,realElectron:true,toolbarAboveQuality:true}));
}catch(e){console.error(e);await (await app.firstWindow()).screenshot({path:'test-results/agent-machine-failure.png'});throw e;}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await runtime.close();}
