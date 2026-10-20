import {_electron as electron} from 'playwright';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {createAgentRuntime} from '../src/agent/runtime';
const data=await mkdtemp(join(tmpdir(),'monitor-agent-'));
const runtime=await createAgentRuntime({directory:join(data,'agent')});
const holder=createServer().listen(0,'127.0.0.1');await once(holder,'listening');
const port=(holder.address() as any).port;await new Promise<void>(r=>holder.close(()=>r()));
await runtime.dispatch('connection.save',{bind:'127.0.0.1',port,password:'fixture-password'});
const env={...process.env,CSHELL_TEST_DATA:join(data,'cshell')};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({args:['.'],env});
try {
  const page=await app.firstWindow();page.setDefaultTimeout(20000);
  await page.getByRole('heading',{name:'工作台',exact:true}).waitFor();
  const id=await page.evaluate(async port=>{
    const info=await window.cshell.clientProbe({host:'127.0.0.1',port});
    const device=await window.cshell.clientPasswordPair(info,'fixture-password');
    await window.cshell.saveProfile({id:device.deviceId,protocol:'client',name:'CAgent fixture',host:device.host,port:device.port,username:'Client',auth:'password',favorite:false,group:''});
    const id=crypto.randomUUID(),displayId=(await window.cshell.viewDisplays())[0].id;
    await window.cshell.saveMonitorView({id,name:'CAgent terminals',mode:'tile',tiles:['cmd','powershell'].map((shell,i)=>({
      id:crypto.randomUUID(),profileId:device.deviceId,label:shell,kind:'client-terminal' as const,shell:shell as 'cmd'|'powershell',displayId,column:i*6,row:0,width:6,height:12,directory:'',command:'',screen:'',
    }))});
    await window.cshell.openMonitorView(id);return id;
  },port);
  await page.waitForTimeout(1200);
  const view=app.windows().find(w=>w!==page)!;view.setDefaultTimeout(20000);
  await view.locator('.xterm').nth(1).waitFor({state:'attached'});
  for(const [i,command] of ['echo CAGENT_CMD_VIEW_OK',"Write-Output 'CAGENT_PS_VIEW_OK'"].entries()){
    await view.locator('.view-terminal textarea').nth(i).focus();
    await view.keyboard.type(command);await view.keyboard.press('Enter');
  }
  await view.waitForTimeout(3500);
  assert.ok((await view.locator('.xterm').first().innerText()).includes('CAGENT_CMD_VIEW_OK'));
  assert.ok((await view.locator('.xterm').nth(1).innerText()).includes('CAGENT_PS_VIEW_OK'));
  assert.equal(await view.locator('[role=alert]').count(),0);
  await view.screenshot({path:'test-results/cagent-terminal-views.png'});
  await page.evaluate(id=>window.cshell.closeMonitorView(id),id);
  await writeFile('test-results/cagent-terminal-views.json',JSON.stringify({passed:true,realAgent:true,cmd:true,powershell:true}));
  console.log('PASS: real CAgent CMD and PowerShell in saved view');
} finally {
  await app.evaluate(({app})=>app.exit(0)).catch(()=>{});
  await runtime.close();
  await rm(data,{recursive:true,force:true,maxRetries:3,retryDelay:300}).catch(()=>{});
}
