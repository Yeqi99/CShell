import test from 'node:test';import assert from 'node:assert/strict';
import {registerClassroomTasks} from '../src/desktop/classroom-tasks';
const id='d97bc5c6-f997-410c-8d56-4efaaeb51108';
test('cancellation during accepted start waits for identity-bound job response then sends stop without replay',async()=>{
 const ipc=new Map<string,Function>();let release!:(v:any)=>void;let started=false,starts=0,stops=0;
 const provider={list:()=>[{deviceId:id,fingerprint:'pinned',name:'student'}],call:async(_id:string,{method}:any)=>{
  if(method==='client.status')return {deviceId:id,platform:'win32',methods:['management.script.start']};
  if(method==='agent.shells')return [{shell:'powershell'}];
  if(method==='management.script.start'){starts++;started=true;return new Promise(r=>release=r);}
  if(method==='management.script.cancel'){stops++;return {state:'cancelled'};}
  throw Error(method);
 }};
 const queue=registerClassroomTasks((n,f)=>ipc.set(n,f),provider as any,()=>true,{classroomModels:()=>[],classroomModel:()=>{throw Error();}});
 const plan=await ipc.get('classroom:tasks-prepare')!({targetIds:[id],action:{kind:'script',shell:'powershell',script:'echo test'}});
 const task=await ipc.get('classroom:tasks-execute')!(plan.id);
 for(let i=0;i<50&&!started;i++)await new Promise(r=>setTimeout(r,2));assert.equal(started,true);
 queue.cancel(task.id);release({id:'f5ad9349-1788-4a1a-8174-bf1e701c41e7'});
 for(let i=0;i<50&&!queue.list()[0].finishedAt;i++)await new Promise(r=>setTimeout(r,2));
 assert.equal(starts,1);assert.equal(stops,1);assert.equal(queue.list()[0].rows[0].state,'unknown');queue.dispose();
});
