import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Store} from '../src/core/store';
import {CloudImportConflict, importCloudStages, undoImportedFields} from '../src/core/cloud-import';
import {CloudSync} from '../src/core/cloud-sync';
import {newRecoveryKey,encryptVault,vaultDigest} from '../src/core/cloud-crypto';

const profile=(name:string)=>({id:randomUUID(),name,host:'127.0.0.1',port:22,username:'fixture',group:'',auth:'password' as const,favorite:false});
test('cloud import cannot remove a connection saved while OS credential encryption awaits',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'import-cas-'));let hold=false,release!:()=>void,entered!:()=>void;
 const gate=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r);
 const codec={decrypt:async(v:string)=>v,encrypt:async(v:string)=>{if(hold){entered();await gate;}return v;}};
 try {const store=new Store(dir,codec);await store.saveProfile(profile('existing'));await store.setSecret(store.snapshot().profiles[0].id,{password:'fixture'});const remote=await store.cloudExport();hold=true;const importing=store.cloudImport(remote);await started;await store.saveProfile(profile('new-local'));release();await assert.rejects(importing,CloudImportConflict);assert.equal(store.snapshot().profiles.length,2);const disk=JSON.parse(await readFile(join(dir,'config.json'),'utf8'));assert.equal(disk.profiles.length,2);
 }finally{release?.();await rm(dir,{recursive:true,force:true});}
});
test('store checkpoint predating other module imports protects new groups',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'import-groups-'));const codec={decrypt:async(v:string)=>v,encrypt:async(v:string)=>v};
 try{const store=new Store(dir,codec);const checkpoint=store.cloudCheckpoint(),remote=await store.cloudExport();await store.manageGroup({type:'create',name:'new-group'});await assert.rejects(store.cloudImport(remote,false,checkpoint),CloudImportConflict);assert.deepEqual(store.snapshot().groups,['new-group']);}finally{await rm(dir,{recursive:true,force:true});}
});
test('failed final store commit rolls back earlier modules without replacing concurrent permission edits',async()=>{
 let module:any={policy:{allow:false},name:'before'},other='before';
 await assert.rejects(importCloudStages([
  {value:{policy:{allow:true},name:'remote'},read:()=>structuredClone(module),apply:async v=>{module=v;},restore:async v=>{module=v;}},
  {value:'remote',read:()=>other,apply:async v=>{other=v as string;},restore:async v=>{other=v as string;}},
 ],async()=>{module.policy={allow:false,scope:'local-edit'};throw new CloudImportConflict();}),CloudImportConflict);
 assert.deepEqual(module,{policy:{allow:false,scope:'local-edit'},name:'before'});assert.equal(other,'before');
});
test('arrays containing concurrent additions remain intact and signal a reconciliation conflict',()=>{
 const before={accounts:[{id:'a'}]},remote={accounts:[{id:'b'}]},current={accounts:[{id:'b'},{id:'local'}]};
 const result=undoImportedFields(before,remote,current);assert.deepEqual(result.value,current);assert.equal(result.conflict,true);
});
test('ordinary import failures roll back changed modules before rethrowing',async()=>{
 let value='before';await assert.rejects(importCloudStages([{read:()=>value,value:'remote',apply:async v=>{value=v as string;},restore:async v=>{value=v as string;}}],async()=>{throw Error('fixture failure');}),/fixture failure/);assert.equal(value,'before');
});
test('rollback conflicts pause automatic sync across a restart',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'import-conflict-')),key=newRecoveryKey(),accountId='a'.repeat(32),local={value:'local'};let calls=0;
 const codec={encrypt:async(v:string)=>v,decrypt:async(v:string)=>v};
 const request:typeof fetch=async()=>{calls++;return Response.json({revision:2,envelope:encryptVault({value:'remote'},key,accountId)});};
 const make=()=>new CloudSync(dir,codec,{export:async()=>local,validate:()=>{},import:async()=>{throw new CloudImportConflict();}},'https://fixture.invalid',request);
 try{await writeFile(join(dir,'cloud-sync.enc'),JSON.stringify({session:{accountId,email:'fixture@example.com',token:'fixture'},key,revision:1,digest:vaultDigest(local)}));const cloud=make();await cloud.load();await assert.rejects(cloud.sync('download'),CloudImportConflict);assert.equal(cloud.status().state,'conflict');const restarted=make();await restarted.load();assert.equal(restarted.status().state,'conflict');const previous=calls;await restarted.autoSync();assert.equal(calls,previous);await assert.rejects(restarted.sync(),CloudImportConflict);}finally{await rm(dir,{recursive:true,force:true});}
});

test('local edits queued before the import write boundary abort the import',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'import-queue-')),codec={decrypt:async(v:string)=>v,encrypt:async(v:string)=>v};let release!:()=>void;
 try{const store=new Store(dir,codec);await store.saveProfile(profile('existing'));const remote=await store.cloudExport();const gate=new Promise<void>(r=>release=r);(store as unknown as {writes:Promise<void>}).writes=gate;const importing=store.cloudImport(remote);const saving=store.saveProfile(profile('queued-local'));release();await assert.rejects(importing,CloudImportConflict);await saving;assert.equal(store.snapshot().profiles.length,2);assert.equal(JSON.parse(await readFile(join(dir,'config.json'),'utf8')).profiles.length,2);}finally{release?.();await rm(dir,{recursive:true,force:true});}
});

test('a local save during the import filesystem write is retained by the following serialized save',async()=>{
 const fs=await import('node:fs/promises'),{syncBuiltinESMExports}=await import('node:module');
 const original=fs.default.mkdir;const dir=await mkdtemp(join(tmpdir(),'import-write-'));let release!:()=>void,entered!:()=>void,hold=true;
 const gate=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r),codec={encrypt:async(v:string)=>v,decrypt:async(v:string)=>v};
 try{const store=new Store(dir,codec);await store.saveProfile(profile('existing'));const remote=await store.cloudExport();fs.default.mkdir=(async(...args:Parameters<typeof original>)=>{if(hold&&String(args[0])===dir){hold=false;entered();await gate;}return original(...args);}) as typeof original;syncBuiltinESMExports();const importing=store.cloudImport(remote);await started;const saving=store.saveProfile(profile('during-write'));release();await importing;await saving;assert.equal(store.snapshot().profiles.length,2);assert.equal(JSON.parse(await readFile(join(dir,'config.json'),'utf8')).profiles.length,2);
 }finally{release?.();fs.default.mkdir=original;syncBuiltinESMExports();await rm(dir,{recursive:true,force:true});}
});

test('a failed import write restores its preferences and preserves a concurrent connection save',async()=>{
 const fs=await import('node:fs/promises'),{syncBuiltinESMExports}=await import('node:module');
 const original=fs.default.mkdir;const dir=await mkdtemp(join(tmpdir(),'import-write-fail-'));let release!:()=>void,entered!:()=>void,hold=true;
 const gate=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r),codec={encrypt:async(v:string)=>v,decrypt:async(v:string)=>v};
 try{const store=new Store(dir,codec);await store.saveProfile(profile('existing'));const size=store.snapshot().preferences.sidebarFontSize;const remote=await store.cloudExport();remote.preferences.sidebarFontSize=18;fs.default.mkdir=(async(...args:Parameters<typeof original>)=>{if(hold&&String(args[0])===dir){hold=false;entered();await gate;throw Error('fixture disk failure');}return original(...args);}) as typeof original;syncBuiltinESMExports();const importing=store.cloudImport(remote);await started;const saving=store.saveProfile(profile('during-failed-write'));release();await assert.rejects(importing,/fixture disk failure/);await saving;assert.equal(store.snapshot().profiles.length,2);assert.equal(store.snapshot().preferences.sidebarFontSize,size);const disk=JSON.parse(await readFile(join(dir,'config.json'),'utf8'));assert.equal(disk.profiles.length,2);assert.equal(disk.preferences.sidebarFontSize,size);
 }finally{release?.();fs.default.mkdir=original;syncBuiltinESMExports();await rm(dir,{recursive:true,force:true});}
});

test('account-source imports back up local data and retain conflict pause after restarting',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'source-import-conflict-')),key=newRecoveryKey(),accountId='a'.repeat(32),local={value:'local'};let calls=0;
 const codec={encrypt:async(v:string)=>v,decrypt:async(v:string)=>v};
 const request:typeof fetch=async()=>{calls++;return Response.json({revision:2,envelope:encryptVault({value:'remote'},key,accountId)});};
 const make=()=>new CloudSync(dir,codec,{export:async()=>local,validate:()=>{},import:async()=>{throw new CloudImportConflict();}},'https://fixture.invalid',request);
 try{await writeFile(join(dir,'cloud-sync.enc'),JSON.stringify({session:{accountId,email:'fixture@example.com',token:'fixture'},key,revision:1,digest:vaultDigest(local)}));const cloud=make();await cloud.load();await assert.rejects(cloud.importLocal(accountId,async()=>({value:'source'})),CloudImportConflict);assert.equal(cloud.status().state,'conflict');const {readdir}=await import('node:fs/promises');const backups=await readdir(join(dir,'cloud-backups'));assert.equal(backups.length,1);assert.match(backups[0],/local-import/);assert.deepEqual(JSON.parse(await readFile(join(dir,'cloud-backups',backups[0]),'utf8')),local);const restarted=make();await restarted.load();assert.equal(restarted.status().state,'conflict');await restarted.autoSync();assert.equal(calls,0);}finally{await rm(dir,{recursive:true,force:true});}
});
test('account-source planning cannot overwrite edits made while preparing its import',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'source-import-prepare-')),key=newRecoveryKey(),accountId='a'.repeat(32);let local={value:'before'},imports=0;
 const codec={encrypt:async(v:string)=>v,decrypt:async(v:string)=>v};const cloud=new CloudSync(dir,codec,{export:async()=>structuredClone(local),validate:()=>{},import:async()=>{imports++;}},'https://fixture.invalid',async()=>Response.json({}));
 try{await writeFile(join(dir,'cloud-sync.enc'),JSON.stringify({session:{accountId,email:'fixture@example.com',token:'fixture'},key,revision:1,digest:vaultDigest(local)}));await cloud.load();await assert.rejects(cloud.importLocal(accountId,async()=>{local={value:'user-edit'};return {value:'source'};}),CloudImportConflict);assert.equal(imports,0);assert.equal(local.value,'user-edit');assert.equal(cloud.status().state,'conflict');}finally{await rm(dir,{recursive:true,force:true});}
});
