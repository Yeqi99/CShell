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

test('agent stores a verified procedure and a fresh agent retrieves it from host disk',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'cagent-memory-'));
 const adapter=knowledgeAdapter(directory);
 const codec={encrypt:async(s:string)=>Buffer.from(s).toString('base64'),decrypt:async(s:string)=>Buffer.from(s,'base64').toString()};
 let phase:'write'|'read'='write',sent=false,observed:any;
 const request=(async(_url,init)=>{
  const body=JSON.parse(String(init.body));
  const result=body.messages.filter((message:any)=>message.role==='tool').at(-1);
  if(result){observed=JSON.parse(result.content);return {content:'Verified'};}
  const id=phase==='write'?'knowledge_put':'knowledge_search';
  const args=phase==='write'?{library:'experience',key:'redis',kind:'procedure',title:'Redis health check',content:JSON.stringify({steps:['Check bound port','PING returns PONG'],outcome:'PONG verified'})}:{library:'experience',key:'redis',query:'Redis'};
  sent=true;
  return {tool_calls:[{id:randomUUID(),type:'function',function:{name:'capability_call',arguments:JSON.stringify({packageId:'cagent.knowledge',toolId:id,args})}}]};
 }) as typeof requestAgentModel;
 const create=()=>new CagentAssistant(new ClientVault(directory,codec),{
  shells:async()=>[],applications:async()=>[],execute:async()=>{},allowed:()=>true,
  capabilityTools:()=>Object.entries(knowledgeInputs).filter(([id])=>id!=='knowledge_similar').map(([id,schema])=>({id,toolId:id,packageId:'cagent.knowledge',description:id,inputSchema:z.toJSONSchema(schema) as RuntimeCapabilityTool['inputSchema'],outputSchema:{type:'object',properties:{}},permissions:[id==='knowledge_put'?'knowledge.write':'knowledge.read'],sideEffect:id==='knowledge_put'})),
  capabilityInvoke:async(input:any,signal,owner)=>adapter.invoke(input.toolId,input.args,owner,signal),
 },request);
 let assistant=create();
 const finish=async()=>{
  const task=await assistant.start({requestId:randomUUID(),prompt:'Use the knowledge application to '+phase+' the verified Redis procedure'},'local');
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
