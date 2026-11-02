import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/core/store';
import {AccountDiscovery} from '../src/core/account-discovery';
const codec={encrypt:async(v:string)=>v,decrypt:async(v:string)=>v};
const device={deviceId:'878615fd-1aa5-41bf-9638-149f0d9338b8',name:'Phone',certificate:'certificate',host:'relay.example.com',port:24443,accountManaged:true,accountPassword:'secret'};
test('account discovery opt-in, identity match, persistent grouping and offline retention',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'account-discovery-'));try{
  const store=new Store(dir,codec);await store.load();let account='a',online=true;let mismatch=false,calls=0;
  const make=()=>new AccountDiscovery(dir,store,()=>account,()=>[device],async()=>{calls++;return [{...device,certificate:mismatch?'wrong':device.certificate,online}];},()=>{});
  const d=make();await d.refresh();assert.equal(calls,0);assert.equal(store.snapshot().profiles.length,0);
  mismatch=true;await d.set(true);assert.equal(store.snapshot().profiles.length,0);assert.equal(d.status().pending,1);
  mismatch=false;await d.refresh();assert.equal(store.profile(device.deviceId).group,'同账号设备');
  await store.saveProfile({...store.profile(device.deviceId),name:'My phone',group:'Lab',favorite:true});
  online=false;await d.refresh();assert.equal(store.profile(device.deviceId).group,'Lab');assert.equal(store.profile(device.deviceId).name,'My phone');assert.equal(d.status().devices[0].online,false);
  const reloaded=make();await reloaded.refresh();assert.equal(reloaded.status().enabled,true);assert.equal(store.profile(device.deviceId).group,'Lab');
  await reloaded.set(false);const previous=calls;await reloaded.refresh();assert.equal(calls,previous);assert.equal(store.snapshot().profiles.length,1);
  account='b';await reloaded.refresh();assert.deepEqual(reloaded.status(),{enabled:false,devices:[],pending:0});
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('discovery does not apply late account responses or register unauthenticated/borrowed records',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'account-discovery-race-'));try{
  const store=new Store(dir,codec);await store.load();let account='a';let release:()=>void=()=>{};
  const waiting=new Promise<void>(r=>release=r);
  const d=new AccountDiscovery(dir,store,()=>account,()=>[device],async()=>{await waiting;return [{...device,online:true}];},()=>{});
  const set=d.set(true);await new Promise(r=>setTimeout(r,20));account='b';release();await set;assert.equal(store.snapshot().profiles.length,0);await d.get();assert.equal(d.status().devices.length,0);
  const locked=new AccountDiscovery(dir,store,()=>account,()=>[{...device,accountPassword:undefined}],async()=>[{...device,online:true}],()=>{});await locked.set(true);assert.equal(locked.status().pending,1);assert.equal(store.snapshot().profiles.length,0);
 }finally{await rm(dir,{recursive:true,force:true});}
});
