import {remoteWechatTools} from '../src/core/remote-wechat-tools';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {callAgent} from '../src/agent/control';
import {ClientProvider} from '../src/core/client/provider';
import {ClientVault,fingerprint} from '../src/core/client/identity';
import {emptyWechatConfig} from '../src/shared/wechat';
const root=resolve('release/0.6.32/agent-win32-x64'),directory=await mkdtemp(join(tmpdir(),'wechat-agent-e2e-'));
const child=spawn(join(root,'node.exe'),[join(root,'agent.cjs'),'run'],{env:{...process.env,CSHELL_AGENT_DATA:directory},windowsHide:true,stdio:'ignore'});
const provider=new ClientProvider(new ClientVault(join(directory,'controller'),{encrypt:async s=>Buffer.from(s).toString('base64'),decrypt:async s=>Buffer.from(s,'base64').toString()}),()=>{});
const local=(m:string,p?:unknown)=>callAgent(m,p,directory);
try{
 for(let n=0;;n++){try{await local('client.status');break;}catch(e){if(n>100)throw e;await new Promise(r=>setTimeout(r,200));}}
 const catalog=await local('packages.catalog');assert(catalog.some((p:any)=>p.id==='cagent.wechat'&&!p.installed));
 await local('packages.install',{id:'cagent.wechat',confirm:true});
 const listen=createServer().listen(0,'127.0.0.1');await once(listen,'listening');const port=(listen.address() as any).port;await new Promise<void>(r=>listen.close(()=>r()));
 const password=randomUUID();await local('client.access',{password,shells:['cmd'],allowManage:true,allowHttp:false,allowHosting:false,allowRelay:false});await local('client.start',{bind:'127.0.0.1',port});
 await provider.load();const probe=await provider.probe({host:'127.0.0.1',port});assert.equal(fingerprint(probe.certificate),(await local('client.status')).fingerprint);await provider.pairPassword(probe,password);
 const remote=(method:any,params?:unknown)=>provider.call(probe.deviceId,{method,params});
 const status=await remote('wechat.status') as any;assert(status.processes.length>0);
 await remote('packages.grant',{id:'cagent.wechat',permissions:['wechat.read']});
 await remote('wechat.configure',{...emptyWechatConfig(),enabled:true,experimental:true,pid:status.processes[0].pid,readContacts:true});
 const tools=await remote('packages.tools') as any[];assert(tools.some(t=>t.id==='wechat_contacts'));assert(!tools.some(t=>t.id==='wechat_send_text'));
 const modelTools=await remoteWechatTools((call,signal)=>provider.call(probe.deviceId,call,signal),new AbortController().signal);
 const contacts=JSON.parse(await modelTools.find(t=>t.name==='remote_wechat_contacts')!.invoke({limit:1},new AbortController().signal));
 await assert.rejects(remote('packages.invoke',{packageId:'cagent.wechat',toolId:'wechat_send_text',args:{recipient:'filehelper',text:'not sent',idempotencyKey:'never_send_test'}}));
 const refreshed=await remote('packages.refresh',{id:'cagent.wechat'}) as any;assert.equal(refreshed.status,'available');
 await remote('packages.grant',{id:'cagent.wechat',permissions:[]});assert(!(await remote('packages.tools') as any[]).some(t=>t.packageId==='cagent.wechat'));
 await writeFile('test-results/wechat-cagent-e2e-0.6.32.json',JSON.stringify({tlsPaired:true,targetRuntime:'0.6.32',catalog:true,remoteConfiguration:true,readCompleted:true,resultKeys:Object.keys(contacts),sendDenied:true,revocation:true,noMessagesSent:true},null,2));
 console.log('PASS target WeChat read through authenticated CAgent RPC, denied send, revocation');
}finally{await provider.dispose();await local('agent.shutdown',{confirm:true}).catch(()=>{});}
