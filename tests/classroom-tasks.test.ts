import test from 'node:test';import assert from 'node:assert/strict';import {setTimeout as delay} from 'node:timers/promises';
import {ClassroomTasks,ClassroomTaskFailure,type ClassroomTaskHost} from '../src/core/classroom-tasks';
const target=(id:string)=>({id,identity:'identity-'+id,label:'PC '+id,platform:'win32',capabilities:['script','model','environment','application'] as const});
const request={targetIds:['a','b','c'],action:{kind:'script',shell:'powershell',script:'secret-test-content'}};
const host=(overrides:Partial<ClassroomTaskHost>={}):ClassroomTaskHost=>({resolve:async id=>({...target(id),capabilities:[...target(id).capabilities]}),prepare:async()=>({summary:'Run a script'}),execute:async()=>({message:'Done'}),...overrides});
async function finished(tasks:ClassroomTasks){for(let i=0;i<100;i++){const item=tasks.list()[0];if(item?.finishedAt)return item;await delay(5);}assert.fail('Task did not finish');}
test('batch plan has no side effects or secret payload and is consumed exactly once',async()=>{let count=0;const tasks=new ClassroomTasks(host({execute:async()=>{count++;return{message:'Done'};}}));const plan=await tasks.prepare(request);assert.equal(count,0);assert(!JSON.stringify(plan).includes('secret-test-content'));const started=tasks.execute(plan.id);assert(!JSON.stringify(started).includes('secret-test-content'));assert.throws(()=>tasks.execute(plan.id));const result=await finished(tasks);assert.equal(count,3);assert(result.rows.every(r=>r.state==='succeeded'));});
test('changed identity and unpaired discovery targets never dispatch',async()=>{let changed=false,count=0;const tasks=new ClassroomTasks(host({resolve:async id=>{if(id==='b')throw Error('Not paired');return{...target(id),identity:changed?'different':target(id).identity,capabilities:['script']};},execute:async()=>{count++;return{message:'Done'};}}));const plan=await tasks.prepare(request);assert(plan.targets.find(t=>t.id==='b')?.error);changed=true;tasks.execute(plan.id);const result=await finished(tasks);assert.equal(count,0);assert(result.rows.every(r=>r.state==='failed'));});
test('bounded concurrency and per-target failure do not stop other machines or leak error secrets',async()=>{let running=0,maximum=0;const tasks=new ClassroomTasks(host({execute:async t=>{running++;maximum=Math.max(maximum,running);await delay(15);running--;if(t.id==='b')throw new ClassroomTaskFailure('private-key-do-not-log');return{message:'Done'};}}),2);const p=await tasks.prepare(request);tasks.execute(p.id);const result=await finished(tasks);assert.equal(maximum,2);assert.deepEqual(result.rows.map(r=>r.state),['succeeded','failed','succeeded']);assert(!JSON.stringify(result).includes('private-key'));});
test('cancel leaves dispatched uncertain operation unknown and queued work unexecuted, without replay',async()=>{const dispatched:string[]=[];const tasks=new ClassroomTasks(host({execute:async(t,_a,_p,signal)=>{dispatched.push(t.id);await new Promise<void>((_r,reject)=>signal.addEventListener('abort',()=>reject(Error('Interrupted')),{once:true}));return{message:'Done'};}}),1);const p=await tasks.prepare(request);const task=tasks.execute(p.id);for(let i=0;i<100&&!dispatched.length;i++)await delay(1);tasks.cancel(task.id);const result=await finished(tasks);assert.deepEqual(dispatched,['a']);assert.deepEqual(result.rows.map(r=>r.state),['unknown','cancelled','cancelled']);assert.throws(()=>tasks.execute(p.id));});
test('disabling while prepare is in flight invalidates the pending plan',async()=>{let unblock!:()=>void;const gate=new Promise<void>(r=>unblock=r);const tasks=new ClassroomTasks(host({prepare:async()=>{await gate;return{summary:'Ready'};}}));const preparing=tasks.prepare(request);tasks.dispose();unblock();await assert.rejects(preparing,/计划已丢弃/);assert.deepEqual(tasks.list(),[]);});
test('invalid and duplicate targets or malformed environment values are rejected before host calls',async()=>{let calls=0;const tasks=new ClassroomTasks(host({resolve:async id=>{calls++;return{...target(id),capabilities:['script']};}}));await assert.rejects(tasks.prepare({...request,targetIds:['a','a']}));await assert.rejects(tasks.prepare({targetIds:['a'],action:{kind:'environment',variables:{BAD:123}}}));assert.equal(calls,0);});
test('lost response after dispatch is unknown, not a safe-to-retry failure',async()=>{let calls=0;const tasks=new ClassroomTasks(host({execute:async()=>{calls++;throw Error('Connection dropped after remote accepted');}}));const p=await tasks.prepare({...request,targetIds:['a']});tasks.execute(p.id);const result=await finished(tasks);assert.equal(result.rows[0].state,'unknown');assert.equal(calls,1);});

test('prepare checks at most four machines concurrently and preserves selection order including failures',async()=>{
 let active=0,maximum=0;const ids=Array.from({length:16},(_,i)=>String(i));
 const tasks=new ClassroomTasks(host({prepare:async t=>{active++;maximum=Math.max(maximum,active);try{await delay((16-Number(t.id))%4+1);if(t.id==='5')throw Error('Unavailable');return{summary:'Checked '+t.id};}finally{active--;}}}),8);
 const plan=await tasks.prepare({...request,targetIds:ids});assert.equal(maximum,4);assert.deepEqual(plan.targets.map(t=>t.id),ids);assert(plan.targets[5].error);assert.equal(plan.targets[6].summary,'Checked 6');
});

test('confirmation TTL starts after slow preparation completes, not before network checks',async t=>{
 let now=1000000;t.mock.method(Date,'now',()=>now);
 const tasks=new ClassroomTasks(host({prepare:async()=>{now+=60000;return{summary:'Checked'};}}));
 const plan=await tasks.prepare({...request,targetIds:['a','b','c','d','e','f','g','h']});
 assert.equal(plan.expiresAt,now+120000);assert.doesNotThrow(()=>tasks.execute(plan.id));await finished(tasks);
});

test('fresh batch confirmation does not extend a remote installation plan expiry',async t=>{
 let now=1000000,calls=0;t.mock.method(Date,'now',()=>now);
 const tasks=new ClassroomTasks(host({prepare:async()=>({summary:'Remote plan',opaque:{id:'remote-plan'},expiresAt:now+100}),execute:async()=>{calls++;return{message:'Must not run'};}}));
 const plan=await tasks.prepare({...request,targetIds:['a']});now+=200;assert(plan.expiresAt>now);tasks.execute(plan.id);
 const result=await finished(tasks);assert.equal(calls,0);assert.equal(result.rows[0].state,'failed');
});

test('hasActiveWork tracks all concurrent prepare calls and releases on success or validation failure',async()=>{
 const gates=new Map<string,()=>void>();const tasks=new ClassroomTasks(host({prepare:async target=>{await new Promise<void>(resolve=>gates.set(target.id,resolve));return{summary:'Ready'};}}));
 assert.equal(tasks.hasActiveWork,false);
 const first=tasks.prepare({...request,targetIds:['a']}),second=tasks.prepare({...request,targetIds:['b']});
 assert.equal(tasks.hasActiveWork,true);while(gates.size<2)await delay(1);
 gates.get('a')!();await first;assert.equal(tasks.hasActiveWork,true);
 gates.get('b')!();await second;assert.equal(tasks.hasActiveWork,false);
 await assert.rejects(tasks.prepare({}));assert.equal(tasks.hasActiveWork,false);
});

test('hasActiveWork survives disposal until preparation drains and covers execution until finished',async()=>{
 let releasePrepare!:()=>void,releaseExecute!:()=>void;
 const tasks=new ClassroomTasks(host({prepare:async()=>{await new Promise<void>(resolve=>releasePrepare=resolve);return{summary:'Ready'};},execute:async()=>{await new Promise<void>(resolve=>releaseExecute=resolve);return{message:'Done'};}}));
 const pending=tasks.prepare({...request,targetIds:['a']});while(!releasePrepare)await delay(1);tasks.dispose();assert.equal(tasks.hasActiveWork,true);releasePrepare();await assert.rejects(pending,/计划已丢弃/);assert.equal(tasks.hasActiveWork,false);
 const next=tasks.prepare({...request,targetIds:['a']});await delay(1);releasePrepare();const plan=await next;assert.equal(tasks.hasActiveWork,false);
 tasks.execute(plan.id);assert.equal(tasks.hasActiveWork,true);while(!releaseExecute)await delay(1);releaseExecute();await finished(tasks);assert.equal(tasks.hasActiveWork,false);
});
