import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {defaults,preferencesSchema,type Profile} from '../src/shared/contracts';
import {connectionUsesVisual} from '../src/shared/connection-view';
import {Store} from '../src/core/store';

test('legacy defaults migrate to native while explicit and per-profile choices remain',()=>{
  const {defaultConnectionView,defaultConnectionViewExplicit,...old}=defaults;
  assert.equal(preferencesSchema.parse(old).defaultConnectionView,'original');
  assert.equal(preferencesSchema.parse({...old,defaultConnectionView:'visual'}).defaultConnectionView,'original');
  assert.equal(preferencesSchema.parse({...old,defaultConnectionView:'visual',defaultConnectionViewExplicit:true}).defaultConnectionView,'visual');
  assert.equal(preferencesSchema.parse({...old,defaultConnectionView:'original'}).defaultConnectionView,'original');
  assert.throws(()=>preferencesSchema.parse({...defaults,defaultConnectionView:'invalid'}));
});

test('compact typography defaults and useful lower bounds do not change explicit values',()=>{
  assert.equal(defaults.uiFontSize,14);assert.equal(defaults.sidebarFontSize,12);assert.equal(defaults.sidebarGroupSize,14);
  const small=preferencesSchema.parse({...defaults,sidebarFontSize:8,sidebarGroupSize:8,sidebarDetailSize:8,uiFontSize:9,fontSize:8});
  assert.equal(small.sidebarFontSize,8);assert.equal(small.uiFontSize,9);assert.equal(small.fontSize,8);
  assert.equal(preferencesSchema.parse({...defaults,sidebarFontSize:18}).sidebarFontSize,18);
  assert.throws(()=>preferencesSchema.parse({...defaults,sidebarFontSize:7}));
});

test('machine view overrides survive storage and never turn file connections into terminals',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'connection-view-'));
  const codec={encrypt:async(value:string)=>value,decrypt:async(value:string)=>value};
  try{
    const store=new Store(dir,codec);await store.load();
    const profile:Profile={id:randomUUID(),name:'Fixture',host:'localhost',port:22,username:'fixture',auth:'password',favorite:false,group:'',protocol:'ssh',defaultConnectionView:'visual'};
    await store.saveProfile(profile);
    const restored=new Store(dir,codec);await restored.load();
    assert.equal(restored.snapshot().profiles[0].defaultConnectionView,'visual');
    assert.equal(connectionUsesVisual(restored.snapshot().profiles[0],defaults),true);
    assert.equal(connectionUsesVisual({...profile,defaultConnectionView:'original'},{defaultConnectionView:'visual'}),false);
    for(const protocol of ['sftp','ftp','ftps','http'] as const)assert.equal(connectionUsesVisual({...profile,protocol},defaults),false);
    assert.equal(connectionUsesVisual({...profile,protocol:'client',defaultConnectionView:'original'},defaults),true);
  }finally{await rm(dir,{recursive:true,force:true});}
});
