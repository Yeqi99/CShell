import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Store} from '../src/core/store';
import {AiService} from '../src/core/ai';
import {ConnectionRegistry} from '../src/core/connections/registry';
import {emptyAiPolicy} from '../src/shared/ai';
import {sharedAiConfigSchema} from '../src/shared/shared-ai';
import {mergeCloud} from '../src/core/cloud-merge';
test('concurrent permission changes never combine into a broader grant',()=>{
 const base={ai:{policy:emptyAiPolicy()}};
 const local=structuredClone(base),remote=structuredClone(base);
 local.ai.policy.allMachines=true;remote.ai.policy.application=['connections.read'];
 assert.throws(()=>mergeCloud(base,local,remote),/权限/);
 assert.deepEqual(mergeCloud(base,base,remote),remote);
});
test('account policy restores exact scope and explicit denials; older payload does not clear it',async()=>{
 const root=await mkdtemp(join(tmpdir(),'cshell-cloud-policy-'));
 const create=async(name:string)=>{const dir=join(root,name);await mkdir(dir,{recursive:true});const store=new Store(dir,{encrypt:async s=>Buffer.from(s).toString('base64'),decrypt:async s=>Buffer.from(s,'base64').toString()});await store.load();const ai=new AiService(dir,store,new ConnectionRegistry(()=>undefined));await ai.load();return ai;};
 const services:AiService[]=[];
 try{
  const a=await create('a'),b=await create('b');services.push(a,b);
  const id=randomUUID();const policy={...emptyAiPolicy(),application:['connections.read'],profiles:[id],overrides:[{profileId:id,capabilities:[]}]};
  await a.savePolicy(policy);const payload=sharedAiConfigSchema.parse(a.cloudExport());await b.cloudImport(payload);assert.deepEqual(b.snapshot().policy,policy);
  const {policy:_,...legacy}=payload;await b.cloudImport(legacy);assert.deepEqual(b.snapshot().policy,policy);
  assert.throws(()=>b.cloudValidate({...payload,policy:{...policy,overrides:[...policy.overrides,...policy.overrides]}}),/Duplicate/);
  const persist=(b as any).persist;
  (b as any).persist=async()=>{throw Error('disk full');};
  try {
   await assert.rejects(b.cloudImport({...payload,policy:{...policy,allMachines:true}}),/disk full/);
   assert.deepEqual(b.snapshot().policy,policy);
  }finally{(b as any).persist=persist;}
  const loaded=await create('b');services.push(loaded);assert.deepEqual(loaded.snapshot().policy,policy);
  assert.throws(()=>b.cloudValidate({...payload,policy:{...policy,application:['invented.permission']}}));
 }finally{for(const ai of services)ai.dispose();await rm(root,{recursive:true,force:true});}
});
