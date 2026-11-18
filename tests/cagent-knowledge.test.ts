import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {RuntimeCapabilityTool} from '../src/agent/capability-runtime';
import {CagentAssistant} from '../src/agent/assistant';
import {ClientVault} from '../src/core/client/identity';
import {knowledgeAdapter,knowledgeInputs} from '../src/agent/knowledge';
import type {requestAgentModel} from '../src/agent/model-request';

test('invalid procedure is recoverable and never stored before correction',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'cagent-memory-invalid-'));
 try{
  const adapter=knowledgeAdapter(directory),signal=new AbortController().signal;
  const base={library:'experience',key:'ledger',kind:'procedure',title:'verified reconciliation'};
  const bad=await adapter.invoke('knowledge_put',{...base,content:'plain text is not a structured procedure'},'local',signal) as any;
  assert.equal(bad.stored,false);assert.match(bad.error,/steps/);
  const empty=await adapter.invoke('knowledge_search',{library:'experience',key:'ledger'},'local',signal) as any;
  assert.equal(empty.records.length,0);
  const good=await adapter.invoke('knowledge_put',{...base,content:JSON.stringify({steps:['Deduplicate transaction IDs','Sum signed integer cents'],outcome:'Totals passed verification'})},'local',signal) as any;
  assert.equal(good.stored,true);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('ranked recall finds mixed Chinese/English terms and shows the matching passage within its scope',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'cagent-ranked-'));
 try{
  const adapter=knowledgeAdapter(directory),signal=new AbortController().signal;
  const invoke=(tool:string,args:unknown)=>adapter.invoke(tool,args,'local',signal) as Promise<any>;
  const note={library:'ops',key:'cache',kind:'text',source:'值班记录',title:'Redis 服务',content:'连接超时'};
  await invoke('knowledge_put',{...note,content:'背景。'.repeat(160)+'调整超时后已验证'});
  await invoke('knowledge_put',{...note,title:'Redis 安装',content:'安装包清单'});
  await invoke('knowledge_put',{...note,library:'other'});
  const input={library:'ops',key:'cache',query:'Redis 超时'};
  const {records}=await invoke('knowledge_search',input);
  assert.deepEqual(records.map((r:any)=>r.title),['Redis 服务','Redis 安装']);
  assert.match(records[0].excerpt,/超时/);assert.equal(records[0].source,'值班记录');
  assert.equal((await invoke('knowledge_search',{...input,offset:1})).records[0].id,records[1].id);
  assert.equal((await invoke('knowledge_search',{...input,query:'unrelated'})).records.length,0);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('pre-chunk records remain searchable after sparse migration and retain their original IDs',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'cagent-legacy-'));
 try{
  const {DatabaseSync}=await import('node:sqlite');
  const {mkdir}=await import('node:fs/promises');
  await mkdir(join(dir,'knowledge'));
  const db=new DatabaseSync(join(dir,'knowledge','records.sqlite'));
  db.exec('CREATE TABLE records(id TEXT PRIMARY KEY,library TEXT,key TEXT,kind TEXT,title TEXT,content TEXT,source TEXT,created INTEGER)');
  const id='c'.repeat(64);
  db.prepare('INSERT INTO records VALUES (?,?,?,?,?,?,?,?)').run(id,'ops','db','text','安装记录','说明'.repeat(600)+' ER_LOCK_TIMEOUT','旧手册',1);
  db.close();
  for(let i=0;i<2;i++){
    const result=await knowledgeAdapter(dir).invoke('knowledge_search',{query:'ER_LOCK_TIMEOUT'},'local',new AbortController().signal) as any;
    assert.equal(result.records.length,1);assert.equal(result.records[0].id,id);
    assert(result.records[0].part>0);assert.match(result.records[0].excerpt,/ER_LOCK_TIMEOUT/);
  }
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('hybrid recall keeps evidence for each question and falls back when dense search fails',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'cagent-hybrid-'));
 const env={CAGENT_MILVUS_URL:'https://milvus.invalid',CAGENT_MILVUS_COLLECTION:'test',CAGENT_EMBED_URL:'https://embed.invalid',CAGENT_EMBED_MODEL:'fixture'};
 const previous=Object.entries(env).map(([k])=>[k,process.env[k]] as const);
 Object.assign(process.env,env);
 const original=globalThis.fetch;
 const vectors=new Map<string,number[]>();
 let offline=false;
 globalThis.fetch=async(url,init)=>{
   const body=JSON.parse(String(init?.body));
   if(String(url).includes('embed.invalid'))return Response.json({data:[{embedding:[/备份|快照/.test(body.input)?1:0]}]});
   if(String(url).endsWith('upsert')){for(const v of body.data)vectors.set(v.id,v.vector);return Response.json({code:0,data:{}});}
   if(offline)return new Response('',{status:503});
   return Response.json({code:0,data:[...vectors].filter(([,v])=>v[0]===1 && body.data[0][0]===1).map(([id])=>({id}))});
 };
 try{
   const adapter=knowledgeAdapter(dir),signal=new AbortController().signal;
   const invoke=(tool:string,args:unknown)=>adapter.invoke(tool,args,'local',signal) as Promise<any>;
   const scope={library:'ops',key:'cache'};
   const doc={...scope,title:'值班记录',kind:'text',content:'快照位置在数据盘。\n\n'+'其他背景资料。'.repeat(220)+'\n\n启动前检查 EADDRINUSE 占用端口。'};
   const saved=await invoke('knowledge_put',doc);
   assert.equal(saved.vector,'indexed');assert(vectors.size>1);
   const count=vectors.size;await invoke('knowledge_put',doc);assert.equal(vectors.size,count);
   await invoke('knowledge_put',{...doc,key:'other',title:'隔离的快照'});
   const input={...scope,query:'怎么备份？EADDRINUSE 如何排查？'};
   const {queries,records,fallbackQueries}=await invoke('knowledge_similar',input);
   assert.equal(queries.length,2);assert.deepEqual(fallbackQueries,[]);
   assert.deepEqual(records.map((r:any)=>r.id),[saved.id]);
   assert.match(records[0].excerpt,/快照位置/);
   assert.match(records[0].otherMatches[0].excerpt,/EADDRINUSE/);
   assert.notEqual(records[0].part,records[0].otherMatches[0].part);
   offline=true;const fallback=await invoke('knowledge_similar',input);
   assert.deepEqual(fallback.fallbackQueries,queries);assert.match(fallback.records[0].excerpt,/EADDRINUSE/);
 }finally{
   globalThis.fetch=original;
   for(const [k,v] of previous){if(v===undefined)delete process.env[k];else process.env[k]=v;}
   await rm(dir,{recursive:true,force:true});
 }
});

test('agent stores a verified procedure and a fresh agent retrieves it from host disk',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'cagent-memory-'));
 const adapter=knowledgeAdapter(directory);
 const codec={encrypt:async(s:string)=>Buffer.from(s).toString('base64'),decrypt:async(s:string)=>Buffer.from(s,'base64').toString()};
 let phase:'write'|'read'='write',sent=false,observed:any;
 const request=(async(_url,init)=>{
  const body=JSON.parse(String(init.body));
  const result=body.messages.filter((message:any)=>message.role==='tool').at(-1);
  if(result){observed=JSON.parse(result.content);if(observed.ping!=='PONG')return {content:'Verified'};}
  if(phase==='write' && !result){
   if(!body.tools.some((tool:any)=>tool.function.name==='capability_call'))return {tool_calls:[{id:randomUUID(),type:'function',function:{name:'load_task_context',arguments:'{"group":"all"}'}}]};
   return {tool_calls:[{id:randomUUID(),type:'function',function:{name:'capability_call',arguments:JSON.stringify({packageId:'fixture.redis',toolId:'check',args:{}})}}]};
  }
  const id=phase==='write'?'knowledge_put':'knowledge_search';
  const args=phase==='write'?{library:'experience',key:'redis',kind:'procedure',title:'Redis health check',content:JSON.stringify({steps:['Check bound port','PING returns PONG'],outcome:'PONG verified'})}:{library:'experience',key:'redis',query:'Redis'};
  sent=true;
  if(phase==='read'){
   const search=body.tools.find((tool:any)=>tool.function.name.startsWith('package_') && tool.function.description==='knowledge_search');
   assert.ok(search,'troubleshooting should expose the authorized search tool');
   return {tool_calls:[{id:randomUUID(),type:'function',function:{name:search.function.name,arguments:JSON.stringify({...args,query:'Redis port'})}}]};
  }
  return {tool_calls:[{id:randomUUID(),type:'function',function:{name:'capability_call',arguments:JSON.stringify({packageId:'cagent.knowledge',toolId:id,args})}}]};
 }) as typeof requestAgentModel;
 const create=()=>new CagentAssistant(new ClientVault(directory,codec),{
  shells:async()=>[],applications:async()=>[],execute:async()=>{},allowed:()=>true,
  capabilityTools:()=>[{id:'check',toolId:'check',packageId:'fixture.redis',description:'Check Redis',inputSchema:{type:'object',properties:{}},outputSchema:{type:'object',properties:{}},permissions:[],sideEffect:false} as RuntimeCapabilityTool,...Object.entries(knowledgeInputs).filter(([id])=>id!=='knowledge_similar').map<RuntimeCapabilityTool>(([id,schema])=>({id,toolId:id,packageId:'cagent.knowledge',description:id,inputSchema:z.toJSONSchema(schema) as RuntimeCapabilityTool['inputSchema'],outputSchema:{type:'object',properties:{}},permissions:[id==='knowledge_put'?'knowledge.write':'knowledge.read'],sideEffect:id==='knowledge_put'}))],
  capabilityInvoke:async(input:any,signal,owner)=>input.packageId==='fixture.redis'?{ping:'PONG'}:adapter.invoke(input.toolId,input.args,owner,signal),
 },request);
 let assistant=create();
 const finish=async()=>{
  const task=await assistant.start({requestId:randomUUID(),prompt:phase==='read'?'排查 Redis 端口故障，上次是怎么验证的？':'请检查 Redis 的服务健康状态。'},'local');
  for(let n=0;n<200;n++){if(!['running','approval'].includes(assistant.get(task,'local').state))break;await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal(assistant.get(task,'local').state,'completed',assistant.get(task,'local').error??'');
 };
 try{
  await assistant.load();
  await assistant.configure({endpoint:'https://fixture.invalid/v1',model:'fixture',key:'fixture',commands:false,review:false,delegates:[]});
  await finish();assert.equal(sent,true);assert.equal(observed.stored,true);
  await assistant.close();phase='read';sent=false;assistant=create();await assistant.load();await finish();
  assert.equal(sent,true);assert.equal(observed.records.length,1);
  assert.equal(observed.records[0].title,'Redis health check');
  const record=await adapter.invoke('knowledge_get',{library:'experience',key:'redis',id:observed.records[0].id},'local',new AbortController().signal) as any;
  assert.equal(JSON.parse(record.record.content).outcome,'PONG verified');
 }finally{await assistant.close();await rm(directory,{recursive:true,force:true});}
});

test('a rejected argument can be corrected once without replaying a completed sibling', async () => {
 for (const repeatInvalid of [false,true]) {
  const directory = await mkdtemp(join(tmpdir(),'cagent-correction-'));
  const executed:number[] = [];
  let step = 0;
  function call(amount:number|string) {
   return {id:randomUUID(),type:'function',function:{name:'capability_call',arguments:JSON.stringify({packageId:'test.ledger',toolId:'submit',args:{amount}})}};
  }
  const request = (async (_url,init) => {
   const messages = JSON.parse(String(init.body)).messages;
   if (JSON.parse(String(init.body)).tools.some((tool:any)=>tool.function.name==='load_task_context')) return {tool_calls:[{id:randomUUID(),type:'function',function:{name:'load_task_context',arguments:JSON.stringify({group:'all'})}}]};
   if (++step === 1) return {tool_calls:[call(1),call('2')]};
   if (step === 2) {
    assert.match(messages.filter((m:any)=>m.role==='tool').at(-1).content,/amount/);
    return {tool_calls:[call(repeatInvalid?'2':2)]};
   }
   return {content:'完成'};
  }) as typeof requestAgentModel;
  const assistant = new CagentAssistant(new ClientVault(directory,{
   encrypt:async value=>value,decrypt:async value=>value
  }),{allowed:()=>true,shells:async()=>[],applications:async()=>[],execute:async()=>{},
   capabilityTools:()=>[{id:'submit',packageId:'test.ledger',toolId:'submit',description:'记录整数',
    inputSchema:{type:'object',properties:{amount:{type:'integer'}},required:['amount']},
    outputSchema:{type:'object',properties:{}},permissions:['test.write'],sideEffect:true}],
   capabilityInvoke:async(input:any)=>{executed.push(input.args.amount);return {ok:true};}
  },request);
  try {
   await assistant.load();
   await assistant.configure({endpoint:'https://fixture.invalid/v1',model:'test',key:'fixture',commands:false,review:false,delegates:[]});
   const id=await assistant.start({requestId:randomUUID(),prompt:'提交两笔记录'},'local');
   for(let n=0;n<200 && assistant.get(id,'local').state==='running';n++)await new Promise(resolve=>setTimeout(resolve,10));
   assert.equal(assistant.get(id,'local').state,repeatInvalid?'failed':'completed',assistant.get(id,'local').error??'');
   assert.deepEqual(executed,repeatInvalid?[1]:[1,2]);
   assert.equal(step,repeatInvalid?2:3);
  } finally {await assistant.close();await rm(directory,{recursive:true,force:true});}
 }
});
