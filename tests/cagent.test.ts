import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CagentAssistant} from '../src/agent/assistant';
import {startCagentApp} from '../src/agent/app';
import type {ClientVault} from '../src/core/client/identity';
import type {requestAiReply} from '../src/core/ai-request';
import {request as httpRequest} from 'node:http';
import type {RuntimeCapabilityTool} from '../src/agent/capability-runtime';
const config={endpoint:'https://example.invalid/v1/chat/completions',model:'fixture',key:'secret',commands:true,review:true,delegates:['a'.repeat(64),'b'.repeat(64)]};
test('CAgent progresses beyond sixteen rounds and resumes with owned checkpoint instead of replay',async()=>{
 const data=new Map<string,unknown>();let step=0,executed=0;const requests:any[]=[];
 const vault={read:async(k:string)=>structuredClone(data.get(k)),write:async(k:string,v:unknown)=>{data.set(k,structuredClone(v));}} as unknown as ClientVault;
 const request=(async(_url:any,init:any)=>{requests.push(JSON.parse(init.body));return ++step<=20?{tool_calls:[{id:'c'+step,type:'function',function:{name:'command',arguments:JSON.stringify({shell:'cmd',command:'echo '+step,timeoutMs:120000})}}]}:{content:'verified'};}) as typeof requestAiReply;
 const service=new CagentAssistant(vault,{shells:async()=>[],applications:async()=>[],execute:async()=>({exitCode:0,result:++executed}),allowed:()=>true},request);
 try{await service.load();await service.configure({...config,review:false});const t=await service.start({prompt:'complete all steps',requestId:randomUUID()},'a'.repeat(64));await until(()=>service.get(t,'local').state==='completed');assert.equal(executed,20);
 await assert.rejects(service.start({resumeId:t.id,prompt:'continue',requestId:randomUUID()},'b'.repeat(64)),/不存在/);
 const resumed=await service.start({resumeId:t.id,prompt:'check state',requestId:randomUUID()},'a'.repeat(64));await until(()=>service.get(resumed,'local').state==='completed');assert.match(JSON.stringify(requests.at(-1).messages),/complete all steps/);assert.match(JSON.stringify(requests.at(-1).messages),/never replay/);assert.equal(executed,20);
 }finally{await service.close();}
});
async function fixture(){
 const data=new Map<string,unknown>();let executions=0,allowed=true,replies=0;
 const vault={read:async(k:string)=>structuredClone(data.get(k)),write:async(k:string,v:unknown)=>{data.set(k,structuredClone(v));}} as unknown as ClientVault;
 const request=(async()=>++replies===1?{content:null,tool_calls:[{id:'tool1',type:'function',function:{name:'command',arguments:JSON.stringify({shell:'sh',command:'echo fixture'})}}]}:{content:'done'}) as typeof requestAiReply;
 const service=new CagentAssistant(vault,{shells:async()=>[],applications:async()=>[],execute:async()=>{executions++;return 'ok';},allowed:()=>allowed},request);
 await service.load();return {service,data,get executions(){return executions;},revoke:()=>{allowed=false;}};
}
async function until(fn:()=>boolean){for(let n=0;n<100;n++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw new Error('timeout');}
test('cagent fresh defaults, explicit opt-out, approval, task ownership, live revocation and encrypted-store contract',async()=>{
 const f=await fixture();try{
 assert.equal(f.service.snapshot().commands,true);assert.equal(f.service.snapshot().model,'');await f.service.configure({...config,commands:false,delegates:[]});assert(!('key' in f.service.snapshot()));
 await assert.rejects(f.service.start({prompt:'test',requestId:randomUUID()},'a'.repeat(64)),/未授权/);
 await f.service.configure(config);
 const t=await f.service.start({prompt:'test',requestId:randomUUID()},'a'.repeat(64));
 await until(()=>f.service.get(t,'local').state==='approval');
 assert.equal(f.executions,0);assert.throws(()=>f.service.get(t,'b'.repeat(64)),/不存在/);
 await assert.rejects(f.service.start({prompt:'second',requestId:randomUUID()},'local'),/已有任务/);
 f.revoke();await until(()=>f.service.get(t,'local').state==='cancelled');assert.equal(f.executions,0);
 }finally{await f.service.close();}
});
test('approved command runs once; restart does not replay tasks; configure cancels pending approval',async()=>{
 const f=await fixture();try{
 await f.service.configure(config);const t=await f.service.start({prompt:'test',requestId:randomUUID()},'local');
 await until(()=>f.service.get(t,'local').state==='approval');f.service.approve({...t,allow:true});
 assert.throws(()=>f.service.approve({...t,allow:true}));
 await until(()=>f.service.get(t,'local').state==='completed');assert.equal(f.executions,1);
 await f.service.load();assert.equal(f.executions,1);
 }finally{await f.service.close();}
 const g=await fixture();try{await g.service.configure(config);const t=await g.service.start({prompt:'test',requestId:randomUUID()},'local');await until(()=>g.service.get(t,'local').state==='approval');await g.service.configure({...config,commands:false});await until(()=>g.service.get(t,'local').state==='cancelled');assert.equal(g.executions,0);}finally{await g.service.close();}
});
test('local app checks host, origin, bearer token and fixed method surface',async()=>{
 let calls=0;const app=await startCagentApp('unused',async()=>{calls++;return {ok:true};});
 try{const u=new URL(app.url),token=u.hash.slice(1);u.hash='';const origin=u.origin;
 const send=(headers:Record<string,string>,method='assistant.settings')=>fetch(origin+'/api',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({method})});
 assert.equal((await fetch(origin)).status,200);
 assert.equal((await send({Origin:origin})).status,403);
 assert.equal((await send({Origin:'https://evil.invalid','X-Cagent-Token':token})).status,403);
 assert.equal(await new Promise(resolve=>{const r=httpRequest(origin,{headers:{Host:'evil.invalid'}},res=>{res.resume();resolve(res.statusCode);});r.end();}),403);
 assert.equal((await send({Origin:origin,'X-Cagent-Token':token},'relay.revealCredential')).status,400);
 assert.equal((await send({Origin:origin,'X-Cagent-Token':token})).status,200);assert.equal(calls,1);for(const method of ['update.check','update.download','update.status','update.verify','update.install','update.settings'])assert.equal((await send({Origin:origin,'X-Cagent-Token':token},method)).status,200);
 assert.equal(calls,7,'native and browser update operations reach the authenticated local runtime');
 assert.equal((await send({Origin:origin},'update.verify')).status,403);
 assert.equal((await send({Origin:'https://evil.invalid','X-Cagent-Token':token},'update.verify')).status,403);
 assert.equal((await send({Origin:origin,'X-Cagent-Token':token},'update.commit')).status,400);
 assert.equal(calls,7,'internal commit and unauthenticated verification never reach runtime');
 }finally{await app.close();}
});

test('installed capability tools require side-effect approval and are rechecked after revocation',async()=>{
 const data=new Map<string,unknown>();let granted=true,executions=0;
 const vault={read:async(k:string)=>structuredClone(data.get(k)),write:async(k:string,v:unknown)=>{data.set(k,structuredClone(v));}} as unknown as ClientVault;
 const capability:RuntimeCapabilityTool={packageId:'fixture.app',toolId:'fixture_write',id:'fixture_write',description:'Fixture write',permissions:['fixture.write'],sideEffect:true,inputSchema:{type:'object',properties:{},additionalProperties:false},outputSchema:{type:'object',properties:{}}};
 const request=(async(_url,init)=>{
  const body=JSON.parse(String(init.body));
  if(body.messages.at(-1).role==='user'){
   assert.equal(body.tools.some((tool:any)=>tool.function.name==='capability_call'),granted);
   return {content:null,tool_calls:[{id:randomUUID(),type:'function',function:{name:'capability_call',arguments:JSON.stringify({packageId:'fixture.app',toolId:'fixture_write',args:{}})}}]};
  }
  return {content:'done'};
 }) as typeof requestAiReply;
 const service=new CagentAssistant(vault,{shells:async()=>[],applications:async()=>[],execute:async()=>{},allowed:()=>true,capabilityTools:()=>granted?[capability]:[],capabilityInvoke:async()=>{executions++;return {ok:true};}},request);
 try{
  await service.load();await service.configure({...config,commands:false,review:true});
  const first=await service.start({prompt:'fixture',requestId:randomUUID()},'local');await until(()=>service.get(first,'local').state==='approval');assert.equal(executions,0);
  service.approve({...first,allow:true});await until(()=>service.get(first,'local').state==='completed');assert.equal(executions,1);
  const second=await service.start({prompt:'fixture again',requestId:randomUUID()},'local');await until(()=>service.get(second,'local').state==='approval');granted=false;
  service.approve({...second,allow:true});await until(()=>service.get(second,'local').state==='failed');assert.equal(executions,1);assert.match(service.get(second,'local').error!,/授权已改变/);
  await service.configure({...config,commands:false,review:false});granted=true;
  const third=await service.start({prompt:'authorized unattended fixture',requestId:randomUUID()},'local');
  await until(()=>service.get(third,'local').state==='completed');assert.equal(executions,2);
  // A stale model response cannot turn review=false into a permission grant.
  granted=false;
  const fourth=await service.start({prompt:'unauthorized fixture',requestId:randomUUID()},'local');
  await until(()=>service.get(fourth,'local').state==='failed');assert.equal(executions,2);
  assert.match(service.get(fourth,'local').error!,/未知工具|未安装或未授权/);
 }finally{await service.close();}
});


test('shared bases and account habits survive restart without transferring agent grants',async()=>{
 const f=await fixture();try{
  await f.service.configure({...config,commands:false,review:true,delegates:[]});
  const memory=await f.service.remember({text:'Prefer concise Chinese answers'});const shared=f.service.cloudExport();
  assert.equal(shared.habits?.[0].text,'Prefer concise Chinese answers');assert.equal(shared.providers.length,1);
  const originalId=shared.providers[0].id;
  await f.service.cloudImport({...shared,providers:[{...shared.providers[0],name:'Shared base',model:'new-model'}]});
  assert.equal(f.service.snapshot().commands,false);assert.equal(f.service.snapshot().review,true);assert.deepEqual(f.service.snapshot().delegates,[]);
  assert.equal(f.service.cloudExport().providers[0].id,originalId);
  await f.service.forget(memory[0].id);assert.deepEqual(f.service.cloudExport().habits,[]);
  assert.deepEqual((f.data.get('assistant-shared') as any).habits,[]);
 }finally{await f.service.close();}
});
