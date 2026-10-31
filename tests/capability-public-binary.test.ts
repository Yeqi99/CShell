import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CapabilityRuntime} from '../src/agent/capability-runtime';
import {capabilityCatalog,createBundledCapabilityEntry} from '../src/agent/capability-catalog';
import {parseCapabilityManifest} from '../src/agent/capability-packages';
import {stageCapabilityBundle} from '../src/agent/capability-installer';
import type {AgentApplicationService} from '../src/agent/applications';

test('public binary catalog uses pinned declaration without repository credentials or installation grants',async()=>{
 const base=capabilityCatalog()[0];
 const manifest=parseCapabilityManifest(JSON.parse(base.bundle!).manifest,base.manifestSha256);
 const bundled=createBundledCapabilityEntry({...manifest,id:'cagent.binary-test',adapterId:'cagent.binary-test',license:'Proprietary'},{'NOTICE.txt':Buffer.from('Binary distribution fixture')});
 const raw=JSON.parse(bundled.bundle!).manifest;
 const entry={...bundled,source:'github' as const,bundle:undefined,manifestJson:raw,url:manifest.source.assetUrl,maxBundleBytes:256*1024*1024};
 const runtime=new CapabilityRuntime({directory:tmpdir(),vault:{read:async()=>undefined,write:async()=>{}},applications:{} as AgentApplicationService,agentVersion:'0.8.16',extraPackages:[{entry,adapter:{inspect:async()=>({installed:true,configured:true}),invoke:async()=>({})}}]});
 await runtime.load();assert.equal(runtime.tools().length,0);
 const visible=runtime.catalog().find(x=>x.id===entry.id)!;
 assert.equal(visible.installed,false);assert.ok(!('manifestJson' in visible));assert.ok(!('url' in visible));
 const root=await mkdtemp(join(tmpdir(),'binary-catalog-'));
 try{
  let requests=0;
  const staged=await stageCapabilityBundle(root,entry,new AbortController().signal,(async(_url,init)=>{requests++;assert.equal(init?.headers,undefined);return new Response(bundled.bundle);}) as typeof fetch);
  assert.equal(requests,1);assert.equal(JSON.parse(staged.manifestJson).license,'Proprietary');
  await assert.rejects(stageCapabilityBundle(root,{...entry,maxBundleBytes:257*1024*1024},new AbortController().signal),/budget/);
 }finally{await runtime.dispose();await rm(root,{recursive:true,force:true});}
});

test('native adapter rejects altered remote declaration and source before download or execution',()=>{
 const base=capabilityCatalog()[0];const raw=JSON.parse(base.bundle!).manifest;
 const options={directory:tmpdir(),vault:{read:async()=>undefined,write:async()=>{}},applications:{} as AgentApplicationService,agentVersion:'0.8.16'};
 const make=(manifestJson:string,url:string)=>new CapabilityRuntime({...options,extraPackages:[{entry:{...base,id:'cagent.fake',source:'github',bundle:undefined,manifestJson,url},adapter:{inspect:async()=>({installed:true,configured:true}),invoke:async()=>({})}}]});
 assert.throws(()=>make(raw+' ','https://github.com/Yeqi99/CShell/releases/download/x/a.json'),/digest/);
 assert.throws(()=>make(raw,'https://example.com/a.json'),/source mismatch/);
});


test('large downloads have a bounded size-aware deadline and stalled custom streams cancel',async()=>{
 const {capabilityDownloadTimeout}=await import('../src/agent/capability-installer');
 assert.equal(capabilityDownloadTimeout(256*1024*1024),600000);
 assert.ok(capabilityDownloadTimeout(249850335)>500000);
 assert.ok(capabilityDownloadTimeout(100)<=121000);
 const base=capabilityCatalog()[0],controller=new AbortController();let cancelled=false;
 const remote={...base,source:'github' as const,bundle:undefined,url:JSON.parse(JSON.parse(base.bundle!).manifest).source.assetUrl};
 const pending=stageCapabilityBundle(tmpdir(),remote,controller.signal,(async(_url,init)=>{
  assert.equal(init?.headers,undefined);assert.equal(init?.redirect,'manual');
  setTimeout(()=>controller.abort(new Error('cancel test')),10);
  return new Response(new ReadableStream({cancel(){cancelled=true;}}));
 }) as typeof fetch);
 await assert.rejects(pending,/cancel test/);assert.equal(cancelled,true);
});

