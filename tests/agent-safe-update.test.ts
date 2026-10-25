import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SafeAgentUpdate} from '../src/agent/safe-update';

function fixture(){
 let now=0,count=0,automatic=true,version='0.8.10',phase='ready';const events:string[]=[];
 const hooks={prepare:async()=>{},shutdown:async()=>{},commit:async()=>{}};
 const update=new SafeAgentUpdate({now:()=>now,idleMs:100,available:()=>({phase,automatic,version,path:version}),activity:()=>({terminals:count}),
  admission:value=>events.push('admission:'+value),prepare:async()=>{events.push('prepare');await hooks.prepare();return {cancel:async()=>{events.push('cancel');},recover:async()=>{events.push('recover');},commit:async()=>{events.push('commit');await hooks.commit();}};},
  shutdown:async()=>{events.push('shutdown');await hooks.shutdown();}});
 return {update,events,hooks,time:(n:number)=>{now=n;},work:(n:number)=>{count=n;},auto:(b:boolean)=>{automatic=b;},version:(v:string)=>{version=v;},phase:(v:string)=>{phase=v;}};
}
test('automatic update requires continuously idle real resources, then closes admission before shutdown',async()=>{
 const f=fixture();f.work(1);await f.update.tick();f.time(200);await f.update.tick();assert.deepEqual(f.events,[]);
 f.work(0);await f.update.tick();f.time(299);await f.update.tick();assert.deepEqual(f.events,[]);
 f.time(300);await f.update.tick();assert.deepEqual(f.events,['prepare','admission:true','shutdown','commit']);await f.update.tick();assert.equal(f.events.filter(s=>s==='commit').length,1);f.update.close();
});
test('tasks which begin during preparation defer update and a changed release discards the prepared slot',async()=>{
 const f=fixture();await f.update.tick();f.hooks.prepare=async()=>{f.work(1);};f.time(100);await f.update.tick();assert.deepEqual(f.events,['prepare','admission:true','admission:false']);
 f.version('0.8.11');f.work(0);f.hooks.prepare=async()=>{};f.time(200);await f.update.tick();assert.equal(f.events.at(-1),'cancel');f.time(300);await f.update.tick();assert.equal(f.events.filter(s=>s==='prepare').length,2);assert.equal(f.events.at(-1),'commit');f.update.close();
});
test('a release changing while prepare awaits is cancelled before admission closes',async()=>{
 const f=fixture();await f.update.tick();f.time(100);f.hooks.prepare=async()=>{f.version('0.8.11');};await f.update.tick();assert.deepEqual(f.events,['prepare','cancel']);f.update.close();
});
test('unknown activity is not idle, and an explicit request does not bypass active work',async()=>{
 const f=fixture();f.auto(false);f.work(Number.NaN);await f.update.request();f.time(300);await f.update.tick();assert.deepEqual(f.events,[]);assert.deepEqual(f.update.status().blocking,['terminals']);
 f.work(0);await f.update.tick();f.time(400);await f.update.tick();assert.equal(f.events.at(-1),'commit');f.update.close();
});
test('disabled automatic update does not stage, and shutdown failure recovers the original runtime',async()=>{
 const f=fixture();f.auto(false);await f.update.tick();f.time(1000);await f.update.tick();assert.deepEqual(f.events,[]);
 f.hooks.shutdown=async()=>{throw Error('cleanup failed');};await f.update.request();f.time(1100);await f.update.tick();assert.deepEqual(f.events,['prepare','admission:true','shutdown','recover','admission:false','cancel']);assert.equal(f.update.status().phase,'failed');f.update.close();
});
test('commit owns its rollback; the coordinator never launches an extra old runtime after uncertain commit',async()=>{
 const f=fixture();f.hooks.commit=async()=>{throw Error('handoff uncertain');};await f.update.tick();f.time(100);await f.update.tick();assert.equal(f.events.includes('recover'),false);assert.equal(f.update.status().phase,'failed');f.update.close();
});
