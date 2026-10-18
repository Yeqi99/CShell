import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClientVault } from '../src/core/client/identity';
import { CapabilityRuntime } from '../src/agent/capability-runtime';
import { capabilityCatalog, capabilityDigest, createBundledCapabilityEntry } from '../src/agent/capability-catalog';
import { stageCapabilityBundle } from '../src/agent/capability-installer';
import { parseCapabilityManifest } from '../src/agent/capability-packages';
import type { AgentApplicationService } from '../src/agent/applications';

test('bundled capability installs actual verified files, grants separately and survives restart without expanding grants',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'cagent-pack-runtime-'));
 const vault=new ClientVault(directory,{encrypt:async s=>Buffer.from(s).toString('base64'),decrypt:async s=>Buffer.from(s,'base64').toString()});
 let catalogCalls=0;
 const applications={list:async(owner:string)=>{catalogCalls++;return {owner,platform:process.platform,applications:[]};},install:async()=>{throw new Error('System installation permission denied');}} as unknown as AgentApplicationService;
 const options={directory,vault,applications,agentVersion:'0.6.11'};
 const runtime=new CapabilityRuntime(options);await runtime.load();
 try{
  assert.equal(runtime.catalog()[0].installed,false);
  await assert.rejects(runtime.install({id:'cagent.system-apps',confirm:false}));
  const installed=await runtime.install({id:'cagent.system-apps',confirm:true});assert.equal(installed.status,'authorization-required');assert.equal(runtime.tools().length,0);
  const records=JSON.parse(Buffer.from(await readFile(join(directory,'capability-packages.enc'),'utf8'),'base64').toString());
  assert.match(await readFile(join(records[0].root,'NOTICE.txt'),'utf8'),/trusted cagent runtime/);
  await runtime.grant({id:'cagent.system-apps',permissions:['applications.read']});assert.equal(runtime.tools().length,2);assert.equal(runtime.list()[0].status,'available');
  await assert.rejects(runtime.invoke({packageId:'cagent.system-apps',toolId:'system_apps_install',args:{id:'00000000-0000-4000-8000-000000000000',confirm:true}},'local',new AbortController().signal),/authorized/);
  await runtime.grant({id:'cagent.system-apps',permissions:['applications.read','applications.plan','applications.install']});assert.equal(runtime.tools().length,5);
  const answer=await runtime.invoke({packageId:'cagent.system-apps',toolId:'system_apps_catalog',args:{}},'local',new AbortController().signal);assert.equal((answer as any).owner,'local');assert.equal(catalogCalls,1);
  await assert.rejects(runtime.invoke({packageId:'cagent.system-apps',toolId:'system_apps_catalog',args:{unexpected:true}},'local',new AbortController().signal));
  await runtime.dispose();
  const restored=new CapabilityRuntime(options);await restored.load();assert.equal(restored.list()[0].status,'available');assert.equal(restored.tools().length,5);
  await restored.grant({id:'cagent.system-apps',permissions:[]});assert.equal(restored.tools().length,0);
  await assert.rejects(restored.invoke({packageId:'cagent.system-apps',toolId:'system_apps_catalog',args:{}},'local',new AbortController().signal),/authorized/);
  await restored.uninstall({id:'cagent.system-apps',confirm:true});assert.equal(restored.catalog()[0].installed,false);await restored.dispose();
 }finally{await runtime.dispose();await rm(directory,{recursive:true,force:true});}
});

test('external bundle requires trusted digest and exact file list; oversized and unexpected redirects rejected',async()=>{
 const root=await mkdtemp(join(tmpdir(),'cagent-pack-download-'));const original=capabilityCatalog()[0];
 try{
  const tampered={...original,bundle:original.bundle+' '};await assert.rejects(stageCapabilityBundle(root,tampered,new AbortController().signal),/digest or size/);
  const payload=JSON.parse(original.bundle!);payload.files['../escape']='eA==';const bundle=JSON.stringify(payload);
  const invalid={...original,bundle,bundleBytes:Buffer.byteLength(bundle),bundleSha256:capabilityDigest(bundle)};
  await assert.rejects(stageCapabilityBundle(root,invalid,new AbortController().signal),/Unexpected package file/);
  await assert.rejects(stageCapabilityBundle(root,{...original,bundleBytes:65*1024*1024},new AbortController().signal),/budget/);
  const manifest=parseCapabilityManifest(payload.manifest,original.manifestSha256);
  const remote={...original,source:'github' as const,bundle:undefined,url:manifest.source.assetUrl};
  let requests=0;
  const fetched=await stageCapabilityBundle(root,remote,new AbortController().signal,(async()=>{requests++;return new Response(original.bundle);}) as typeof fetch);assert.equal(requests,1);assert.match(await readFile(join(fetched.root,'NOTICE.txt'),'utf8'),/MIT/);
  await assert.rejects(stageCapabilityBundle(root,remote,new AbortController().signal,(async()=>new Response(null,{status:302,headers:{location:'https://evil.example/package'}})) as typeof fetch),/redirect/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('trusted injected adapter is unavailable until installed and granted; uninstall aborts work before shutdown',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'cagent-pack-extra-'));
 const vault=new ClientVault(directory,{encrypt:async s=>Buffer.from(s).toString('base64'),decrypt:async s=>Buffer.from(s,'base64').toString()});
 const original=capabilityCatalog()[0],base=parseCapabilityManifest(JSON.parse(original.bundle!).manifest,original.manifestSha256);
 const entry=createBundledCapabilityEntry({...base,id:'cagent.fixture',adapterId:'cagent.fixture',name:'Fixture',permissions:['fixture.read'],tools:[{id:'fixture_wait',description:'Wait in fixture',inputSchema:{type:'object',properties:{},additionalProperties:false},outputSchema:{type:'object',properties:{}},permissions:['fixture.read'],sideEffect:false}]},{'NOTICE.txt':Buffer.from('MIT fixture')});
 const calls:string[]=[];
 const adapter={inspect:async()=>({installed:true,configured:true}),invoke:async(_id:string,_args:unknown,_owner:string,signal:AbortSignal)=>{calls.push('invoke');await new Promise<void>(resolve=>signal.addEventListener('abort',()=>{calls.push('aborted');resolve();},{once:true}));return {};},quiesce:async()=>{calls.push('quiesce');},stop:async()=>{calls.push('stop');},unregister:async()=>{calls.push('unregister');}};
 const runtime=new CapabilityRuntime({directory,vault,applications:{} as AgentApplicationService,agentVersion:'0.6.11',extraPackages:[{entry,adapter}]});await runtime.load();
 try{
  assert.equal(runtime.tools().length,0);await runtime.install({id:entry.id,confirm:true});await runtime.grant({id:entry.id,permissions:['fixture.read']});calls.length=0;
  const running=runtime.invoke({packageId:entry.id,toolId:'fixture_wait',args:{}},'local',new AbortController().signal);
  await runtime.uninstall({id:entry.id,confirm:true});await running;
  assert.deepEqual(calls,['invoke','aborted','quiesce','stop','unregister']);
 }finally{await runtime.dispose();await rm(directory,{recursive:true,force:true});}
});

test('same-version trusted bundle digest change restages files and preserves only previous grants',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'cagent-pack-same-version-'));
 const vault=new ClientVault(directory,{encrypt:async s=>Buffer.from(s).toString('base64'),decrypt:async s=>Buffer.from(s,'base64').toString()});
 const original=capabilityCatalog()[0],base=parseCapabilityManifest(JSON.parse(original.bundle!).manifest,original.manifestSha256);
 const manifest:typeof base={...base,id:'cagent.fixture',adapterId:'cagent.fixture',name:'Fixture',permissions:['fixture.read'],tools:[{id:'fixture_read',description:'Read fixture',inputSchema:{type:'object',properties:{},additionalProperties:false},outputSchema:{type:'object',properties:{}},permissions:['fixture.read'],sideEffect:false}]};
 const make=(contents:string,extra=false)=>createBundledCapabilityEntry({...manifest,permissions:extra?['fixture.read','fixture.write']:manifest.permissions},{'NOTICE.txt':Buffer.from(contents)});
 const first=make('old native bytes'),second=make('replacement native bytes',true);
 const adapter=(expected:string)=>({inspect:async(root:string)=>({installed:await readFile(join(root,'NOTICE.txt'),'utf8')===expected,configured:true}),invoke:async()=>({})});
 const options={directory,vault,applications:{} as AgentApplicationService,agentVersion:'0.6.11'};
 const old=new CapabilityRuntime({...options,extraPackages:[{entry:first,adapter:adapter('old native bytes')}]});await old.load();await old.install({id:first.id,confirm:true});await old.grant({id:first.id,permissions:['fixture.read']});await old.dispose();
 const runtime=new CapabilityRuntime({...options,extraPackages:[{entry:second,adapter:adapter('replacement native bytes')}]});
 try{await runtime.load();assert.equal(runtime.list()[0].status,'not-installed');const installed=await runtime.install({id:second.id,confirm:true});assert.equal(installed.status,'available');assert.equal(installed.version,first.version);assert.deepEqual(installed.grants,['fixture.read']);
 const records=JSON.parse(Buffer.from(await readFile(join(directory,'capability-packages.enc'),'utf8'),'base64').toString());assert.equal(records[0].manifestSha256,second.manifestSha256);assert.equal(await readFile(join(records[0].root,'NOTICE.txt'),'utf8'),'replacement native bytes');const root=records[0].root;await runtime.install({id:second.id,confirm:true});const again=JSON.parse(Buffer.from(await readFile(join(directory,'capability-packages.enc'),'utf8'),'base64').toString());assert.equal(again[0].root,root,'identical verified bundle should refresh without restaging');
 }finally{await runtime.dispose();await rm(directory,{recursive:true,force:true});}
});

