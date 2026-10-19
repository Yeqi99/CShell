import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RunBudget,compactContext} from '../src/core/agent-continuity';
import {AgentJobs} from '../src/core/agent-jobs';
test('compression preserves early constraints and entire tool exchanges; failed compaction leaves source intact',async()=>{
 const messages:any[]=[{role:'system',content:'system'},{role:'user',content:'Never delete original files'},...Array.from({length:30},(_,i)=>({role:'user',content:'step '+i+'x'.repeat(100)})),{role:'assistant',tool_calls:[{id:'a'}]},{role:'tool',tool_call_id:'a',content:'verified'}];
 let history='',saved='';await compactContext(messages,async text=>{history=text;return 'Goal preserved; never delete original files; remaining verification';},async s=>{saved=s;},2000);
 assert.match(history,/Never delete original files/);assert.match(saved,/remaining/);assert.equal(messages.at(-1).role,'tool');assert.equal(messages.at(-2).role,'assistant');
 const before=structuredClone(messages);await assert.rejects(compactContext(messages,async()=>{throw Error('offline');},async()=>{},100),/offline|过大/);assert.deepEqual(messages,before);
});
test('budget stops repeated unchanged work and excessive context, not at sixteen model calls',()=>{
 const budget=new RunBudget(100000);for(let i=0;i<50;i++){budget.reserve({step:i});budget.observe('read',{path:i},'new data '+i);}
 for(let i=0;i<4;i++)budget.observe('read','same','unchanged');assert.throws(()=>budget.observe('read','same','unchanged'),/重复/);assert.throws(()=>budget.reserve('x'.repeat(100000)),/预算/);
});
test('background jobs support nonblocking start, output cursor, ownership, waiting and cancellation',async()=>{
 const jobs=new AgentJobs(),parent=new AbortController();let finish!:()=>void;
 const job=await jobs.start('a',parent.signal,async(signal,out)=>{out('first');await new Promise<void>(r=>{finish=r;signal.addEventListener('abort',()=>r(),{once:true});});signal.throwIfAborted();out('second');return 'done';});
 await assert.rejects(jobs.query('b',{id:job.id}),/不属于/);let q=await jobs.query('a',{id:job.id});assert.equal(q.output,'first');assert.equal(q.state,'running');finish();q=await jobs.query('a',{id:job.id,offset:q.nextOffset,waitMs:100});assert.equal(q.state,'completed');assert.match(q.output,/second/);
 const other=await jobs.start('a',parent.signal,async signal=>{await new Promise<void>(r=>signal.addEventListener('abort',()=>r(),{once:true}));signal.throwIfAborted();return '';});await jobs.query('a',{id:other.id},true);await jobs.stopOwner('a');assert.equal((await jobs.query('a',{id:other.id})).state,'cancelled');
});
