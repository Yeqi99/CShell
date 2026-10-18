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
 const page=await app.firstWindow();page.setDefaultTimeout(15000);console.log("window");await page.getByRole('heading',{name:'尚未连接'}).waitFor();
 await page.evaluate(async({port})=>{const info=await window.cshell.clientProbe({host:'127.0.0.1',port});const device=await window.cshell.clientPasswordPair(info,'fixture-password');await window.cshell.saveProfile({id:device.deviceId,protocol:'client',name:'机器工作区测试',host:device.host,port:device.port,username:'Client',auth:'password',favorite:false,group:''});},{port});
 console.log("paired");await runtime.dispatch('connection.save',{bind:'127.0.0.1',port,password:'fixture-password'});await page.reload();await page.getByText('机器工作区测试',{exact:true}).first().dblclick();
 const machine=page.locator('.agent-machine:visible');await machine.waitFor();console.log("machine");assert.equal(await machine.locator('.terminal-pane').count(),0);
 await machine.getByRole('button',{name:'远程桌面',exact:true}).click();await machine.getByRole('button',{name:'连接桌面',exact:true}).waitFor();
 console.log('desktop');await machine.getByRole('button',{name:'设置与权限',exact:true}).click();await machine.getByRole('button',{name:'连接与权限',exact:true}).waitFor();await machine.getByLabel('对外地址',{exact:true}).fill('draft.example.test');
 await machine.getByRole('button',{name:'终端',exact:true}).click();await machine.getByRole('button',{name:/＋.*CMD/i}).click();await machine.locator('.terminal-pane.active .xterm-helper-textarea').waitFor();
 await machine.locator('.terminal-pane.active .xterm-helper-textarea').focus();await page.keyboard.type('echo MACHINE_WORKSPACE_OK');await page.keyboard.press('Enter');await page.waitForTimeout(800);
 console.log('terminal');await machine.getByRole('button',{name:'应用市场',exact:true}).click();await machine.getByRole('heading',{name:'应用市场',exact:true}).waitFor();
 await machine.getByRole('button',{name:'终端',exact:true}).click();assert.equal(await machine.locator('.terminal-pane').count(),1);
 await machine.getByRole('button',{name:/＋.*PowerShell/i}).click();await machine.locator('.terminal-pane').nth(1).waitFor({state:'attached'});assert.equal(await machine.locator('.terminal-pane').count(),2);
 await machine.getByRole('button',{name:'设置与权限',exact:true}).click();assert.equal(await machine.getByLabel('对外地址',{exact:true}).inputValue(),'draft.example.test');await machine.getByRole('button',{name:'终端',exact:true}).click();await page.screenshot({path:'test-results/agent-machine-workspace.png'});
 
 const id=await page.evaluate(async()=>{const devices=await window.cshell.clientDevices();return devices[0].deviceId;});
 const target=await page.evaluate(id=>window.cshell.agentMachineOpen(id),id);await page.getByRole('button',{name:'关闭 机器工作区测试',exact:true}).click();await machine.waitFor({state:'detached'});
 const rejected=await page.evaluate(async target=>{try{await window.cshell.agentCall(target,{method:'agent.shells'});return false;}catch{return true;}},target.id);assert.equal(rejected,true);
 await runtime.dispatch('connection.save',{bind:'127.0.0.1',port,password:'changed-fixture-password'});
 await page.getByText('机器工作区测试',{exact:true}).first().dblclick();await page.getByRole('button',{name:'重新认证',exact:true}).waitFor();await page.getByRole('alert').filter({hasText:'认证失败'}).waitFor();assert.equal(await page.getByRole('heading',{name:'编辑连接',exact:true}).count(),0);
 await page.getByRole('button',{name:'重新认证',exact:true}).click();await page.getByLabel('连接密码',{exact:true}).fill('changed-fixture-password');await page.getByRole('button',{name:'认证并连接',exact:true}).click();await machine.waitFor();
 await writeFile('test-results/agent-machine-smoke.json',JSON.stringify({passed:true,noTerminalNeeded:true,desktopWithoutPlugin:true,settingsWithoutPlugin:true,multipleTerminals:true,sectionsPreserved:true,closedTargetRejected:true},null,2));
}catch(e){console.error(e);await (await app.firstWindow()).screenshot({path:'test-results/agent-machine-failure.png'});throw e;}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await runtime.close();}
