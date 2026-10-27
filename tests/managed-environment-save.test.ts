import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ManagedEnvironment} from '../src/agent/managed-classroom';
import type {ClientVault} from '../src/core/client/identity';

test('concurrent classroom environment changes merge in request order and survive reload', async () => {
 let saved:Record<string,string>={KEEP:'original'}, effective:Record<string,string>={};
 const vault={read:async()=>({...saved}),write:async(_name:string,value:Record<string,string>)=>{await new Promise(r=>setImmediate(r));saved={...value};}} as unknown as ClientVault;
 const environment=new ManagedEnvironment(vault,v=>{effective=v;});await environment.load();
 await Promise.all([
  environment.save({variables:{HTTP_PROXY:'http://teacher:7890'}}),
  environment.save({variables:{COURSE_ENV:'dl'}}),
  environment.save({variables:{KEEP:null}}),
 ]);
 assert.deepEqual(effective,{HTTP_PROXY:'http://teacher:7890',COURSE_ENV:'dl'});
 assert.deepEqual(saved,effective);
 const reloaded=new ManagedEnvironment(vault,v=>{effective=v;});await reloaded.load();
 assert.deepEqual(reloaded.snapshot().names,['COURSE_ENV','HTTP_PROXY']);
});

test('failed environment save does not apply or poison the next queued update', async () => {
 let saved:Record<string,string>={KEEP:'original'}, effective:Record<string,string>={};let attempts=0;
 const vault={read:async()=>({...saved}),write:async(_name:string,value:Record<string,string>)=>{if(++attempts===1)throw Error('disk unavailable');saved={...value};}} as unknown as ClientVault;
 const environment=new ManagedEnvironment(vault,v=>{effective=v;});await environment.load();
 const failed=environment.save({variables:{KEEP:'unsaved'}});
 const next=environment.save({variables:{COURSE_ENV:'dl'}});
 await assert.rejects(failed,/disk unavailable/);await next;
 assert.deepEqual(effective,{KEEP:'original',COURSE_ENV:'dl'});assert.deepEqual(saved,effective);
});

test('queued changes enforce the total limit and recover after deleting a variable', async () => {
 let saved=Object.fromEntries(Array.from({length:99},(_,i)=>['ITEM_'+i,'value']));
 const vault={read:async()=>({...saved}),write:async(_name:string,value:Record<string,string>)=>{saved={...value};}} as unknown as ClientVault;
 const environment=new ManagedEnvironment(vault,()=>{});await environment.load();
 const results=await Promise.allSettled([
  environment.save({variables:{FIRST:'value'}}),
  environment.save({variables:{SECOND:'value'}}),
  environment.save({variables:{FIRST:null,SECOND:'final'}}),
 ]);
 assert.deepEqual(results.map(r=>r.status),['fulfilled','rejected','fulfilled']);
 assert.equal(Object.keys(saved).length,100);assert.equal(saved.SECOND,'final');assert.equal(saved.FIRST,undefined);
});
