import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/core/store';
import {AiService} from '../src/core/ai';
import {ConnectionRegistry} from '../src/core/connections/registry';
import {emptyAiPolicy,newInstallationAiPolicy,aiCapabilities} from '../src/shared/ai';
import {emptySharedAi} from '../src/shared/shared-ai';

const codec={encrypt:async(value:string)=>value,decrypt:async(value:string)=>value};
test('only explicitly fresh desktop installation initializes known AI capabilities; MCP stays off',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'cshell-first-ai-'));const services:AiService[]=[];
 const open=async(initialize:boolean)=>{const store=new Store(dir,codec);await store.load();const ai=new AiService(dir,store,new ConnectionRegistry(()=>undefined));services.push(ai);await ai.load(initialize);return {ai,store};};
 try{
  const first=await open(true);assert.deepEqual(first.ai.snapshot().policy,newInstallationAiPolicy());
  assert.deepEqual(first.ai.registrationPolicy(),newInstallationAiPolicy());
  assert.deepEqual((await open(true)).ai.registrationPolicy(),newInstallationAiPolicy(),'untouched generated default survives restart before registration');
  assert.deepEqual(first.ai.snapshot().policy.capabilities,[...aiCapabilities]);
  assert.equal(first.store.mcpSettings().enabled,false);assert.equal(first.store.mcpSettings().allowCommands,false);
  await first.ai.savePolicy(emptyAiPolicy());
  assert.deepEqual(first.ai.registrationPolicy(),emptyAiPolicy(),'edited guest permissions are not silently uploaded on registration');
  await first.ai.savePolicy(newInstallationAiPolicy());
  assert.deepEqual(first.ai.registrationPolicy(),emptyAiPolicy(),'even explicitly broad guest grants require import consent');
  assert.deepEqual((await open(true)).ai.registrationPolicy(),emptyAiPolicy(),'saved explicit grants stay nonportable on restart');
  await first.ai.savePolicy(emptyAiPolicy());
  assert.deepEqual((await open(true)).ai.snapshot().policy,emptyAiPolicy(),'explicit denial survives restart');
  const legacy=JSON.parse(await readFile(join(dir,'ai.enc'),'utf8'));delete legacy.policy;
  await writeFile(join(dir,'ai.enc'),JSON.stringify(legacy));
  assert.deepEqual((await open(true)).ai.snapshot().policy,emptyAiPolicy(),'legacy missing policy remains denied');
  legacy.policy=newInstallationAiPolicy();delete legacy.untouchedInstallationPolicy;
  await writeFile(join(dir,'ai.enc'),JSON.stringify(legacy));
  assert.deepEqual((await open(true)).ai.registrationPolicy(),emptyAiPolicy(),'legacy identical grants do not imply first-install origin');
 }finally{services.forEach(ai=>ai.dispose());await rm(dir,{recursive:true,force:true});}
});

test('existing app, fresh account workspace and cloud missing-policy payload never gain first-install grants',async()=>{
 const root=await mkdtemp(join(tmpdir(),'cshell-account-ai-'));const services:AiService[]=[];
 try{
  const existing=new Store(root,codec);await existing.load();await existing.setMcpSettings(existing.mcpSettings());
  const reload=new Store(root,codec);await reload.load();assert.equal(reload.isNewInstallation(),false);
  const legacy=new AiService(root,reload,new ConnectionRegistry(()=>undefined));services.push(legacy);await legacy.load(true);
  assert.deepEqual(legacy.snapshot().policy,emptyAiPolicy());
  for(const account of ['account-a','account-b']){
   const directory=join(root,account),store=new Store(directory,codec);await store.load();
   const ai=new AiService(directory,store,new ConnectionRegistry(()=>undefined));services.push(ai);await ai.load(false);
   await ai.cloudImport(emptySharedAi());assert.deepEqual(ai.snapshot().policy,emptyAiPolicy());
  }
  const bad=join(root,'ai.enc');await writeFile(bad,'broken');
  await assert.rejects(legacy.load(true),/preserved/);assert.equal(await readFile(bad,'utf8'),'broken');
 }finally{services.forEach(ai=>ai.dispose());await rm(root,{recursive:true,force:true});}
});
