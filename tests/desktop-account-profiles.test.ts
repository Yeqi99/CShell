import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DesktopAccountProfiles,AccountWorkspaceMismatch} from '../src/core/desktop-account-profiles';
import {readdir} from 'node:fs/promises';
import {CloudSync} from '../src/core/cloud-sync';
import {encryptVault,newRecoveryKey,wrapRecoveryKey} from '../src/core/cloud-crypto';

test('mismatched authentication is quarantined before returning to guest; no cloud requests or config writes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'desktop-recovery-'));const a='a'.repeat(32),b='b'.repeat(32);
 const codec={encrypt:async(s:string)=>s,decrypt:async(s:string)=>s};let calls=0;
 try{
  await writeFile(join(root,'Local State'),'fixture-context');await writeFile(join(root,'config.json'),'original account config');
  const profiles=new DesktopAccountProfiles(root);await profiles.initialize(a);
  const original=JSON.stringify({session:{accountId:b,email:'fixture@example.com',token:'x'.repeat(43)},key:newRecoveryKey(),revision:7});await writeFile(join(root,'cloud-sync.enc'),original);
  const cloud=new CloudSync(root,codec,{export:async()=>{throw Error('must not export');},validate:()=>{},import:async()=>{throw Error('must not import');}},'https://fixture.invalid',async()=>{calls++;throw Error('must not request');});
  await cloud.load();await assert.rejects(profiles.initialize(cloud.accountId()),AccountWorkspaceMismatch);
  await cloud.quarantineWorkspaceSession();const guest=await profiles.prepare();await guest.commit();await cloud.autoSync();await cloud.accountStatus();assert.equal(calls,0);
  const backup=(await readdir(root)).find(n=>n.startsWith('cloud-sync-recovery-'));assert(backup);assert.equal(await readFile(join(root,backup),'utf8'),original);assert.equal(await readFile(join(root,'config.json'),'utf8'),'original account config');
  assert.notEqual(guest.directory,root);await assert.rejects(readFile(join(guest.directory,'config.json')),{code:'ENOENT'});assert.equal(new DesktopAccountProfiles(root).current(),'guest');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('desktop profiles preserve the legacy directory and copy only the encryption context',async()=>{
 const root=await mkdtemp(join(tmpdir(),'desktop-profiles-'));
 try{
  await writeFile(join(root,'Local State'),'fixture-context');await writeFile(join(root,'config.json'),'guest configuration');
  const profiles=new DesktopAccountProfiles(root);await profiles.initialize();
  const a=await profiles.prepare('a'.repeat(32));
  assert.equal(await readFile(join(a.directory,'Local State'),'utf8'),'fixture-context');
  await assert.rejects(readFile(join(a.directory,'config.json')), {code:'ENOENT'});
  assert.equal(new DesktopAccountProfiles(root).directory(),root);
  await a.commit();assert.equal(new DesktopAccountProfiles(root).directory(),a.directory);
  await profiles.initialize('a'.repeat(32));await assert.rejects(profiles.initialize('b'.repeat(32)));
  const guest=await profiles.prepare();assert.equal(guest.directory,root);await guest.commit();
  assert.equal(await readFile(join(root,'config.json'),'utf8'),'guest configuration');
  await assert.rejects(profiles.prepare('../outside'));
 }finally{await rm(root,{recursive:true,force:true});}
});

test('desktop authentication hands off before sync; guest data never enters the account vault',async()=>{
 const root=await mkdtemp(join(tmpdir(),'desktop-handoff-'));const accountId='a'.repeat(32),key=newRecoveryKey();
 const envelope=encryptVault({connections:['account machine']},key,accountId);
 const codec={encrypt:async(s:string)=>Buffer.from(s).toString('base64'),decrypt:async(s:string)=>Buffer.from(s,'base64').toString()};
 let imported=0,exported=0,vaultRequests=0;
 const request:typeof fetch=async(url)=>{
  if(String(url).endsWith('password-login'))return Response.json({accountId,email:'fixture@example.com',token:'x'.repeat(43),keybox:wrapRecoveryKey(key,'fixture-password',accountId)});
  if(String(url).endsWith('/vault')){vaultRequests++;return Response.json({revision:1,envelope});}
  return Response.json({ok:true});
 };
 try{
  await writeFile(join(root,'Local State'),'fixture-context');
  const profiles=new DesktopAccountProfiles(root);await profiles.initialize();
  const guest=new CloudSync(root,codec,{export:async()=>{exported++;return {secret:'guest'};},validate:()=>{},import:async()=>{imported++;},activationTarget:id=>profiles.prepare(id)},'https://fixture.invalid',request);
  await guest.load();await guest.login('fixture@example.com','fixture-password',true);
  assert(guest.activationDeferred());await guest.autoSync();await guest.accountStatus();
  assert.equal(vaultRequests,0);assert.equal(exported,0);assert.equal(imported,0);
  await assert.rejects(readFile(join(root,'cloud-sync.enc')),{code:'ENOENT'});
  let restored:unknown;
  const restarted=new CloudSync(new DesktopAccountProfiles(root).directory(),codec,{export:async()=>({connections:[]}),validate:()=>{},import:async v=>{restored=v;}},'https://fixture.invalid',request);
  await restarted.load();await restarted.autoSync();assert.deepEqual(restored,{connections:['account machine']});
 }finally{await rm(root,{recursive:true,force:true});}
});
