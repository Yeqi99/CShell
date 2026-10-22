import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CagentCloud} from '../src/agent/cloud';
import {CagentAssistant} from '../src/agent/assistant';
import {ClientVault} from '../src/core/client/identity';
import {decryptVault,encryptVault,unwrapRecoveryKey} from '../src/core/cloud-crypto';

test('CAgent keeps guest habits out of registration and restores isolated accounts on logout',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'cagent-accounts-'));
  const codec={encrypt:async(s:string)=>Buffer.from(s).toString('base64'),decrypt:async(s:string)=>Buffer.from(s,'base64').toString()};
  const vault=new ClientVault(directory,codec);
  const assistant=new CagentAssistant(vault,{shells:async()=>[],applications:async()=>[],execute:async()=>'',allowed:()=>false});
  const accounts=new Map<string,any>();let selected:any;
  const request:typeof fetch=async(url,options)=>{
    const path=new URL(String(url)).pathname,body=options?.body?JSON.parse(String(options.body)):undefined;
    if(path.endsWith('/auth/register')){selected={...body,revision:1};accounts.set(body.email,selected);return Response.json({accountId:body.accountId,email:body.email,token:'x'.repeat(43)});}
    if(path.endsWith('/auth/password-login')){selected=accounts.get(body.email);return Response.json({accountId:selected.accountId,email:selected.email,token:'y'.repeat(43),keybox:selected.keybox});}
    if(path.endsWith('/vault')){if(body){selected.envelope=body.envelope;selected.revision++;return Response.json({revision:selected.revision});}return Response.json({revision:selected.revision,envelope:selected.envelope});}
    return Response.json({ok:true});
  };
  const cloud=new CagentCloud(directory,codec,vault,assistant,request);
  try{
    await assistant.load();await assistant.remember({text:'Guest preference'});await cloud.load();
    await cloud.call('account.register',{email:'a@example.com',password:'fixture-password',code:'123456'});
    assert.deepEqual(assistant.cloudExport().habits,[]);
    const a=accounts.get('a@example.com'),key=unwrapRecoveryKey(a.keybox,'fixture-password',a.accountId);
    assert.deepEqual((decryptVault(a.envelope,key,a.accountId) as any).ai.habits,[]);
    await assistant.remember({text:'Account A preference'});
    await cloud.call('account.logout',{});
    assert.equal(assistant.cloudExport().habits?.[0].text,'Guest preference');
    await cloud.call('account.register',{email:'b@example.com',password:'fixture-password',code:'123456'});
    assert.deepEqual(assistant.cloudExport().habits,[]);
    await assistant.remember({text:'Account B preference'});
    await cloud.call('account.logout',{});
    assert.equal(assistant.cloudExport().habits?.[0].text,'Guest preference');
    assert(!JSON.stringify(accounts.get('b@example.com')).includes('Guest preference'));
    const remote=decryptVault(a.envelope,key,a.accountId) as any;
    remote.opencode={accounts:[{id:'default',name:'fixture',key:'opencode-test-secret'}]};
    remote.futureExtension={enabled:true,opaque:'preserve-me'};
    a.envelope=encryptVault(remote,key,a.accountId);a.revision++;
    await cloud.call('account.login',{email:'a@example.com',password:'fixture-password'});
    assert.equal(assistant.cloudExport().habits?.[0].text,'Account A preference');
    const updated=decryptVault(a.envelope,key,a.accountId) as any;
    assert.deepEqual(updated.opencode,remote.opencode);
    assert.deepEqual(updated.futureExtension,remote.futureExtension);
    await cloud.call('account.logout',{});
    await cloud.call('account.login',{email:'b@example.com',password:'fixture-password'});
    assert.equal(assistant.cloudExport().habits?.[0].text,'Account B preference');
  }finally{await cloud.close();await assistant.close();await rm(directory,{recursive:true,force:true});}
});
