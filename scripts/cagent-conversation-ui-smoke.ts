import {_electron as electron} from 'playwright';
import {mkdtemp,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {createAgentRuntime} from '../src/agent/runtime';
const data=await mkdtemp(join(tmpdir(),'cagent-conversation-'));
const runtime=await createAgentRuntime({directory:join(data,'agent')});
const holder=createServer().listen(0,'127.0.0.1');await once(holder,'listening');
const port=(holder.address() as any).port;await new Promise<void>(resolve=>holder.close(()=>resolve()));
await runtime.dispatch('connection.save',{bind:'127.0.0.1',port,password:'fixture-password'});
await runtime.dispatch('assistant.configure',{endpoint:'https://fixture.invalid/v1',model:'Shared model',key:'fixture',commands:false,review:true,delegates:['*']});
const env={...process.env,CSHELL_TEST_DATA:join(data,'cshell'),CSHELL_TEST_START_GATE:'1'};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({args:process.env.CSHELL_EXECUTABLE?[]:['.'],executablePath:process.env.CSHELL_EXECUTABLE,env});
await app.evaluate(()=>{(globalThis as any).__cshellPackagedTestAttached=true;});
await mkdir('test-results',{recursive:true});
try{
 const page=await app.firstWindow();page.setDefaultTimeout(20000);
 await page.getByRole('heading',{name:'工作台',exact:true}).waitFor();
 await page.evaluate(async port=>{
  const info=await window.cshell.clientProbe({host:'127.0.0.1',port});
  const device=await window.cshell.clientPasswordPair(info,'fixture-password');
  await window.cshell.saveProfile({id:device.deviceId,protocol:'client',name:'知识库验证机器',host:device.host,port:device.port,username:'Client',auth:'password',favorite:false,group:''});
 },port);
 await page.reload();await page.getByText('知识库验证机器',{exact:true}).first().dblclick();
 await page.locator('[data-desktop-icon=assistant]').last().dblclick();
 const chat=page.locator('.machine-chat:visible');await chat.waitFor();
 await chat.getByRole('heading',{name:'想完成什么工作？'}).waitFor();
 await chat.getByLabel('交给这台机器的任务').fill('保留这条任务草稿');
 await chat.getByRole('button',{name:'模型与权限',exact:true}).click();
 await chat.getByRole('button',{name:'同步当前 CShell 账号',exact:true}).waitFor();
 await chat.getByRole('button',{name:'返回对话',exact:true}).click();
 assert.equal(await chat.getByLabel('交给这台机器的任务').inputValue(),'保留这条任务草稿');
 await chat.getByRole('combobox',{name:'智能体基座'}).waitFor();
 await page.screenshot({path:'test-results/cagent-conversation-light.png'});
 await page.getByRole('button',{name:'切换桌面明暗主题',exact:true}).click();
 await page.screenshot({path:'test-results/cagent-conversation-dark.png'});
 const overflow=await chat.evaluate(el=>el.scrollWidth>el.clientWidth+1);
 assert.equal(overflow,false);
 console.log('PASS real paired machine, model picker, account action, draft preservation, light/dark and no horizontal overflow');
}catch(error){await (await app.firstWindow()).screenshot({path:'test-results/cagent-conversation-failure.png'});throw error;}
finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await runtime.close();}
