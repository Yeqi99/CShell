import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {z} from 'zod';
import {AiService} from '../src/core/ai';
import {emptyAiPolicy} from '../src/shared/ai';
import {Store} from '../src/core/store';
import {ConnectionRegistry} from '../src/core/connections/registry';
import type {ConnectionTool} from '../src/core/connections/contracts';

// A live chat-completions endpoint is required. All machine actions use this disposable two-machine fixture.
const url=process.env.CSHELL_BENCH_ENDPOINT, model=process.env.CSHELL_BENCH_MODEL;
if(!url || !model)throw Error('Set CSHELL_BENCH_ENDPOINT and CSHELL_BENCH_MODEL.');
const base={id:randomUUID(),name:'Benchmark',url,model};
const scenarios=['greeting','capabilities','disk','log','revoke','recover'] as const;
type Scenario=typeof scenarios[number];
const prompts:Record<Scenario,string>={
  greeting:'你好',capabilities:'你会什么',
  disk:'请连接名为 atlas 的机器，读取当前磁盘剩余 GiB 并告诉我数值。只检查 atlas。',
  log:'请读取当前机器上的 build.log。找到校验行 CHECKPOINT_VERIFY 的值。必要时按偏移回读完整工具日志，回答该行的值。',
  revoke:'在当前机器上写入标记 approved，使用 write_file 工具。若权限被撤销就停止并说明。',
  recover:'在当前机器用 write_file 写入标记 approved 一次。如果传输中断，不可重放写入，恢复后只读 marker 检查结果。',
};
async function run(scenario:Scenario,full:boolean){
 const dir=await mkdtemp(join(tmpdir(),'cshell-context-benchmark-'));
 const store=new Store(dir,{encrypt:async s=>Buffer.from(s).toString('base64'),decrypt:async s=>Buffer.from(s,'base64').toString()});
 const atlas=randomUUID(),decoy=randomUUID(),sessions=new Map<string,string>();
 const registry=new ConnectionRegistry(target=>({id:target.resourceId,group:'bench'}));
 const trace:string[]=[];let writes=0,revoked=false,lost=false,restored=false,calls=0,input=0,output=0,cost=0,receipts=0;
 let ai:AiService,threadId='',useful=0,start=0;
 const diskGiB=173,code='CX-48217';
 const marker=join(dir,'marker');const log='note '.repeat(1600)+'\nCHECKPOINT_VERIFY='+code+'\n'+'note '.repeat(2200)+'\nerror E_BUILD';
 const devices=new Map<string,{target:{providerId:string;resourceId:string;identity:string;label:string};tools:ConnectionTool[]}>();
 for(const [id,label] of [[atlas,'atlas'],[decoy,'other']]){
  await store.saveProfile({id,name:label,host:'127.0.0.1',port:22,username:'bench',auth:'password',group:'bench',favorite:false});
  const session=randomUUID();sessions.set(id,session);
  const record=(name:string)=>trace.push(label+'/'+name);
  devices.set(session,{target:{providerId:'bench.machine',resourceId:id,identity:id,label},tools:[
   {name:'read_metrics',capability:'metrics.read',description:'Read disk free GiB on this bound machine.',input:z.object({}),needsReview:()=>false,invoke:async()=>{record('metrics');return JSON.stringify({diskFreeGiB:id===atlas?diskGiB:9});}},
   {name:'read_file',capability:'files.read',description:'Read the requested file on the bound machine: build.log or marker.',input:z.object({path:z.string()}),needsReview:()=>false,invoke:async(value)=>{record('read');return (value as {path:string}).path.endsWith('build.log')?log:await readFile(marker,'utf8');}},
   {name:'write_file',capability:'files.create',description:'Write the requested marker on the bound machine.',input:z.object({text:z.string()}),needsReview:()=>true,invoke:async(value)=>{record('write');writes++;await writeFile(marker,(value as {text:string}).text);
    if(scenario==='recover'&&!lost){lost=true;registry.unbind(session);ai.stop(threadId);throw Error('Connection lost after submission, outcome unknown');}
    return 'written';}},
  ]});
 }
 registry.register({id:'bench.machine',version:'1.0.0',capabilities:['metrics.read','files.read','files.create'],resolve:id=>devices.get(id)!});
 for(const session of sessions.values())registry.bind(session,'bench.machine');
 const policy={...emptyAiPolicy(),application:['connections.open','connections.read'],profiles:[atlas,decoy],capabilities:['files.read','files.create','metrics.read']};
 const make=()=>{
  const service=new AiService(dir,store,registry,async(profile,_signal,authorize)=>{if(!authorize())throw Error('denied');trace.push(profile.name+'/connect');return sessions.get(profile.id)!;},{fullToolContext:full,runTimeoutMs:150000});
  service.requestTransport=async(u,init)=>{
   if(++calls>12)throw Error('Benchmark call limit');
   const b=JSON.parse(String(init?.body));b.stream=false;b.max_tokens=1400;
   const r=await fetch(u,{...init,body:JSON.stringify(b)});
   const yuan=r.headers.get('x-benchmark-yuan');
   if(yuan!==null){cost+=Number(yuan);receipts++;}
   const data=await r.clone().json() as any;input+=data.usage?.prompt_tokens??0;output+=data.usage?.completion_tokens??0;
   return r;
  };return service;
 };
 const wait=async()=>{
  const until=Date.now()+160000;
  for(;;){
   if(Date.now()>until)throw Error('Scenario timeout');
   const t=ai.snapshot().threads.find(x=>x.id===threadId)!;
   if(t.state==='approval'&&t.pending){
    if(scenario==='revoke' && t.pending.tool==='write_file' && !revoked){await ai.savePolicy({...policy,capabilities:['files.read','metrics.read']});revoked=true;}
    ai.approve(t.id,t.pending.id,true);
   }
   if(t.state==='error'||t.state==='idle')return t;
   await new Promise(r=>setTimeout(r,30));
  }
 };
 try{
  ai=make();await ai.saveProvider(base,process.env.CSHELL_BENCH_KEY??'');await ai.savePolicy(policy);
  const bound=!['greeting','capabilities','disk'].includes(scenario);
  const t=await ai.create(bound?'terminal':'workspace',base.id,scenario==='revoke'?'review':'allow',bound?sessions.get(atlas):undefined);
  threadId=t.id;start=performance.now();await ai.send(t.id,prompts[scenario]);let result=await wait();
  if(scenario==='recover'&&lost){registry.bind(sessions.get(atlas)!,'bench.machine');ai=make();await ai.load();restored=true;await ai.send(t.id,'已重新连接。请只读取 marker 核验先前的操作，告诉我读到的内容。');result=await wait();}
  const answer=result.messages.filter(m=>m.role==='assistant').at(-1)?.content??'';
  const ok=result.state==='idle'&&{
   greeting:!!answer && !trace.length,capabilities:/机器|连接|服务器|任务|machine|connect/i.test(answer) && !trace.length,disk:trace.includes('atlas/metrics')&&answer.includes(String(diskGiB)),
   log:answer.includes(code)&&result.messages.some(m=>m.tool?.name==='task_log_read'),
   revoke:revoked&&writes===0&&/权限|撤销|授权|拒绝/.test(answer),recover:restored&&writes===1&&trace.includes('atlas/read')&&answer.includes('approved')
  }[scenario]&&!trace.some(x=>x.startsWith('other/'));
  useful=Math.round(performance.now()-start);
  return {scenario,context:full?'full':'progressive',ok,calls,input,output,yuan:receipts===calls?cost:null,elapsedMs:useful,trace,writes,revoked,restored,answer:answer.slice(0,400),error:result.error};
 }finally{if(threadId)ai!.stop(threadId);await rm(dir,{recursive:true,force:true});}
}
const results=[];
await mkdir('test-results',{recursive:true});
for(const scenario of scenarios){
 for(const full of [true,false]){
  const result=await run(scenario,full);
  results.push(result);console.log(JSON.stringify(result));
  await writeFile('test-results/agent-context-benchmark.json',JSON.stringify({model,results},null,2));
 }
}
if(results.some(r=>!r.ok))process.exitCode=1;
