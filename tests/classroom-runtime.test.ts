import {randomUUID} from 'node:crypto';import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createServer as tcpServer} from 'node:net';import {createServer as httpServer} from 'node:http';import {setTimeout as delay} from 'node:timers/promises';
import {createAgentRuntime} from '../src/agent/runtime';import {ClientProvider} from '../src/core/client/provider';import {ClientVault,fingerprint} from '../src/core/client/identity';import {registerClassroomTasks} from '../src/desktop/classroom-tasks';
import type {AgentCall} from '../src/shared/agent';
const codec={encrypt:async(v:string)=>Buffer.from(v).toString('base64'),decrypt:async(v:string)=>Buffer.from(v,'base64').toString()};
async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),'cshell-classroom-runtime-'));const runtime=await createAgentRuntime({directory:join(directory,'agent')});
 const provider=new ClientProvider(new ClientVault(join(directory,'controller'),codec),()=>{});await provider.load();
 const portServer=tcpServer();await new Promise<void>(r=>portServer.listen(0,'127.0.0.1',r));const port=(portServer.address() as {port:number}).port;await new Promise<void>(r=>portServer.close(()=>r()));
 const shell=process.platform==='win32'?'cmd':'sh';const password='isolated-classroom-fixture-password';
 await runtime.server.setAccess({password,shells:[shell],allowManage:true,allowHttp:false,allowHosting:false,allowRelay:false});await runtime.server.start({bind:'127.0.0.1',port});
 const probe=await provider.probe({host:'127.0.0.1',port});assert.equal(fingerprint(probe.certificate),runtime.server.status().fingerprint);
 const device=await provider.pairPassword(probe,password);
 const call=(method:AgentCall['method'],params?:unknown)=>provider.call(device.deviceId,{method,params});
 return {directory,runtime,provider,device,shell,call,port,close:async()=>{provider.dispose();await runtime.close();await rm(directory,{recursive:true,force:true,maxRetries:5});}};
}
test('real loopback TLS CAgent persists private environment and executes safe child script; management adapter runs without opening terminal', {timeout:45000}, async()=>{
 const f=await fixture();try{
  const saved=await f.call('environment.save',{variables:{CLASSROOM_FIXTURE_VALUE:'fixture-value-517'}}) as any;assert(saved.names.includes('CLASSROOM_FIXTURE_VALUE'));assert(!JSON.stringify(saved).includes('fixture-value-517'));
  const encrypted=await readFile(join(f.directory,'agent','managed-environment.enc'));assert(!encrypted.includes(Buffer.from('fixture-value-517')));
  const command=f.shell==='cmd'?'echo %CLASSROOM_FIXTURE_VALUE%':'printf "%s" "$CLASSROOM_FIXTURE_VALUE"';
  const job=await f.call('management.script.start',{shell:f.shell,command,timeoutMs:5000}) as any;let result:any;
  for(let i=0;i<20;i++){result=await f.call('management.script.status',{id:job.id,waitMs:500});if(result.state!=='running')break;}
  assert.equal(result.state,'completed');assert.match(result.output,/fixture-value-517/);assert.equal((await f.runtime.dispatch('update.status',{}) as any).coordination.activity.terminals,0);
  const handlers=new Map<string,Function>();let enabled=true;const queue=registerClassroomTasks((name,fn)=>handlers.set(name,fn),f.provider,()=>enabled,{classroomModels:()=>[],classroomModel:()=>{throw Error('No model fixture');}});
  try{const targets=await handlers.get('classroom:tasks-targets')!();assert.equal(targets[0].id,f.device.deviceId);assert(targets[0].capabilities.includes('environment'));
   const plan=await handlers.get('classroom:tasks-prepare')!({targetIds:[f.device.deviceId],action:{kind:'environment',variables:{CLASSROOM_FIXTURE_VALUE:null}}});assert.equal(plan.targets[0].error,undefined);handlers.get('classroom:tasks-execute')!(plan.id);
   let task:any;for(let i=0;i<100;i++){task=handlers.get('classroom:tasks-list')!()[0];if(task.finishedAt)break;await delay(20);}assert.equal(task.rows[0].state,'succeeded');assert.deepEqual((await f.call('environment.read') as any).names,[]);
   enabled=false;assert.throws(()=>handlers.get('classroom:tasks-list')!(),/启用/);
  }finally{queue.dispose();}
  await f.runtime.server.stop();await f.runtime.server.setAccess({password:'isolated-classroom-fixture-password',shells:[f.shell],allowManage:false});await f.runtime.server.start({bind:'127.0.0.1',port:f.port});await assert.rejects(f.call('environment.save',{variables:{CLASSROOM_FIXTURE_VALUE:'blocked'}}));
 }finally{await f.close();}
});
test('real TLS model patch preserves grants and rejects while an isolated assistant request is running', {timeout:45000},async()=>{
 const f=await fixture();let received!:()=>void;const incoming=new Promise<void>(r=>received=r);const sockets=new Set<import('node:net').Socket>();
 const api=httpServer((_req,_res)=>{received();});api.on('connection',s=>{sockets.add(s);s.once('close',()=>sockets.delete(s));});await new Promise<void>(r=>api.listen(0,'127.0.0.1',r));
 try{const endpoint=`http://127.0.0.1:${(api.address() as {port:number}).port}/v1/chat/completions`;
  await f.runtime.dispatch('assistant.configure',{endpoint,model:'fixture-before',key:'fixture-secret-only',commands:false,review:true,delegates:['*']});
  const updated=await f.call('assistant.model.configure',{endpoint,model:'fixture-after',key:'fixture-next-secret'}) as any;
  assert.equal(updated.commands,false);assert.equal(updated.review,true);assert.deepEqual(updated.delegates,['*']);assert.equal(updated.model,'fixture-after');assert.equal(updated.keyConfigured,true);assert.equal(updated.key,undefined);
  const job=await f.call('assistant.start',{prompt:'Local fixture only, no tools',requestId:randomUUID()}) as any;
  await Promise.race([incoming,delay(7000).then(()=>{throw Error('Local model endpoint not reached');})]);
  await assert.rejects(f.call('assistant.model.configure',{endpoint,model:'must-not-replace',key:'fixture-key'}));
  const during=await f.call('assistant.settings') as any;assert.equal(during.model,'fixture-after');assert.equal(during.commands,false);assert.equal(during.review,true);
  await f.call('assistant.cancel',{id:job.id});
 }finally{for(const s of sockets)s.destroy();await new Promise<void>(r=>api.close(()=>r()));await f.close();}
});
