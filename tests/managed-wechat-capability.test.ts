import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod';
import { buildManagedWechatManifest, createManagedWechatCapability, managedWechatConfigureSchema } from '../src/agent/managed-wechat-capability';
import { capabilityDigest, type CapabilityCatalogEntry } from '../src/agent/capability-catalog';

function entry(){const manifest=buildManagedWechatManifest({wechatVersion:'4.1.15.56',version:'0.1.0',methods:['status','send','contacts'],source:{repository:'https://github.com/Yeqi99/CShell',releaseTag:'toolkit-test',assetUrl:'https://github.com/Yeqi99/CShell/releases/download/toolkit-test/toolkit.json'},files:[{path:'WeixinToolkit.exe',bytes:4,sha256:capabilityDigest('test')}]});const manifestJson=JSON.stringify(manifest);return{manifest,entry:{id:manifest.id,name:manifest.name,description:manifest.description,version:manifest.version,permissions:manifest.permissions,source:'github',url:manifest.source.assetUrl,manifestJson,manifestSha256:capabilityDigest(manifestJson),bundleSha256:capabilityDigest('test'),bundleBytes:4} satisfies CapabilityCatalogEntry};}
test('manifest separates reads, sends, and API grants and settings never infer broad targets',()=>{
 const {manifest}=entry();assert.equal(manifest.compatibility.agentVersion.min,'0.8.17');assert.equal(manifest.tools.find(x=>x.id==='wechat_send')?.sideEffect,true);assert.equal(manifest.tools.find(x=>x.id==='wechat_contacts')?.sideEffect,false);assert.deepEqual(manifest.tools.find(x=>x.id==='wechat_contacts')?.permissions,['wechat.api','wechat.contacts.read']);assert.deepEqual(managedWechatConfigureSchema.parse({}).sendTargets,[]);assert.throws(()=>managedWechatConfigureSchema.parse({subscriptionEnabled:true}));
});
test('factory persists encrypted ownership before submissions; cross-owner queries, conflicts and unknown replay are refused',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'wechat-factory-')),storage=new Map<string,unknown>();let submits=0,stops=0,fail=false;
 const vault={read:async<T>(key:string,schema:z.ZodType<T>)=>storage.has(key)?schema.parse(structuredClone(storage.get(key))):undefined,write:async(key:string,value:unknown)=>{storage.set(key,structuredClone(value));}};
 const options={entry:entry().entry,directory,vault,authorize:()=>true,profileReady:async()=>true,initialize:async(_exe:string,path:string)=>{await writeFile(path,JSON.stringify({dataDir:join(dirname(path),'data'),permissions:{}}));},serviceFactory:()=>({verify:async()=>{},start:async()=>{},stop:async()=>{stops++;},health:async()=>({}),capabilities:async()=>({}),submit:async()=>{submits++;assert([...storage.values()].some(v=>JSON.stringify(v).includes('owner-a')));if(fail)throw Error('Connection interrupted');return{id:'a'.repeat(32)};},operation:async(id:string)=>({id,state:'unknown'})})};
 const f=await createManagedWechatCapability(options);const signal=new AbortController().signal;
 try{
  await f.configure({apiEnabled:true,sendTargets:['peer']});await f.adapter.register!(directory,['wechat.api','wechat.send']);assert.equal(f.status().running,true);assert(!JSON.stringify(f.status()).includes('apiToken'));
  const result=await f.adapter.invoke('wechat_send',{params:{recipient:'peer',text:'hello'},idempotencyKey:'request-0001'},'owner-a',signal);assert.deepEqual(result,{id:'a'.repeat(32)});
  await assert.rejects(f.adapter.invoke('wechat_operation',{id:'a'.repeat(32)},'owner-b',signal),/another caller/);
  await f.adapter.invoke('wechat_send',{params:{recipient:'peer',text:'hello'},idempotencyKey:'request-0001'},'owner-a',signal);assert.equal(submits,1);
  await assert.rejects(f.adapter.invoke('wechat_send',{params:{text:'different'},idempotencyKey:'request-0001'},'owner-a',signal),/conflict/);
  await assert.rejects(f.adapter.invoke('wechat_contacts',{params:{},idempotencyKey:'contacts-001'},'owner-a',signal),/not granted/);
  fail=true;await assert.rejects(f.adapter.invoke('wechat_send',{params:{recipient:'peer'},idempotencyKey:'request-0002'},'owner-a',signal));
  await assert.rejects(f.adapter.invoke('wechat_send',{params:{recipient:'peer'},idempotencyKey:'request-0002'},'owner-a',signal),/unknown/);assert.equal(submits,2);
  await f.shutdown();assert(stops>0);const restored=await createManagedWechatCapability(options);await restored.adapter.register!(directory,['wechat.api','wechat.send']);await assert.rejects(restored.adapter.invoke('wechat_send',{params:{recipient:'peer'},idempotencyKey:'request-0002'},'owner-a',signal),/unknown/);await restored.shutdown();
 }finally{await f.shutdown();await rm(directory,{recursive:true,force:true});}
});
test('quarantined or unvalidated profile is never registered as business-ready',async()=>{
 const storage=new Map<string,unknown>(),directory=await mkdtemp(join(tmpdir(),'wechat-profile-'));let starts=0;
 const f=await createManagedWechatCapability({entry:entry().entry,directory,nativeCommand:async(_exe,args)=>({bound:args.includes('--bind'),validation:{valid:false},liveEnabled:false}),initialize:async(_exe,path)=>{await writeFile(path,JSON.stringify({dataDir:join(dirname(path),'data'),permissions:{}}));},vault:{read:async<T>(k:string,s:z.ZodType<T>)=>storage.has(k)?s.parse(storage.get(k)):undefined,write:async(k,v)=>{storage.set(k,v);}},authorize:()=>true,serviceFactory:()=>({verify:async()=>{},start:async()=>{starts++;},stop:async()=>{},health:async()=>({}),capabilities:async()=>({}),submit:async()=>({}),operation:async()=>({})})});
 try{await f.configure({apiEnabled:true});assert.equal((await f.adapter.inspect(directory)).configured,false);await f.adapter.register!(directory,['wechat.api','wechat.read']);assert.equal(starts,0);assert.equal(f.status().running,false);assert.deepEqual(await f.bind(123),{bound:true,validation:{valid:false},liveEnabled:false});assert.equal(starts,0);assert.deepEqual(await f.availableStatus(),{bound:false,validation:{valid:false},liveEnabled:false});}finally{await f.shutdown();await rm(directory,{recursive:true,force:true});}
});

test('explicit configuration and granted filehelper scope precede validation without auto-selecting a process',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'wechat-validation-')),storage=new Map<string,unknown>();let nativeValid=false,starts=0;let granted:string[]=[];
 const f=await createManagedWechatCapability({entry:entry().entry,directory,vault:{read:async<T>(k:string,s:z.ZodType<T>)=>storage.has(k)?s.parse(storage.get(k)):undefined,write:async(k,v)=>{storage.set(k,v);}},authorize:()=>true,getGrants:()=>granted,
  initialize:async(_exe,path)=>{await writeFile(path,JSON.stringify({dataDir:join(dirname(path),'data'),permissions:{enabled:false}}));},
  nativeCommand:async(_exe,args)=>{if(args.includes('--validate')){const config=JSON.parse(await readFile(args[args.indexOf('--config')+1],'utf8'));assert.equal(config.permissions.enabled,true);assert.deepEqual(config.permissions.receive,['filehelper']);nativeValid=true;return{validated:true};}return{liveEnabled:true,bound:true,boundPid:123,validation:{valid:nativeValid}};},
  serviceFactory:()=>({verify:async()=>{},start:async()=>{starts++;},stop:async()=>{},health:async()=>({}),capabilities:async()=>({}),submit:async()=>({}),operation:async()=>({})})});
 try{await f.adapter.inspect(directory);await f.configure({apiEnabled:true,receiveTargets:['filehelper']});await assert.rejects(f.validate(),/requires/);granted=['wechat.api','wechat.events.read'];assert.deepEqual(await f.validate(),{validated:true});assert.equal(starts,1);assert.equal((await f.adapter.inspect(directory)).configured,true);}finally{await f.shutdown();await rm(directory,{recursive:true,force:true});}
});


test('callback event normalization maps explicit direction, retains explicit ownership and real conversation IDs',async()=>{
  const {managedWechatEventData}=await import('../src/agent/managed-wechat-capability');
  assert.deepEqual(managedWechatEventData({direction:'incoming',conversationId:'room'}),{direction:'incoming',conversationId:'room',isSelf:false});
  assert.equal(managedWechatEventData({direction:'outgoing'}).isSelf,true);
  assert.equal(managedWechatEventData({direction:'incoming',isSelf:true}).isSelf,true);
  assert.equal(managedWechatEventData({direction:'outgoing',isSelf:false}).isSelf,false);
  for(const input of [{},{direction:'unknown'},{direction:'Incoming'},{isSelf:'false'}])assert.equal(Object.hasOwn(managedWechatEventData(input),'isSelf'),false);
  assert.equal(Object.hasOwn(managedWechatEventData({token:'secret',conversation:'wrong'}),'token'),false);
  assert.equal(managedWechatEventData({text:'x'.repeat(1300)}).text?.toString().length,1200);
});

