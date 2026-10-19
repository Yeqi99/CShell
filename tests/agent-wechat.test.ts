import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createWechatCapability} from '../src/agent/wechat-capability';
import {capabilityDigest} from '../src/agent/capability-catalog';
import {CapabilityRuntime} from '../src/agent/capability-runtime';
import {ClientVault} from '../src/core/client/identity';
import type {AgentApplicationService} from '../src/agent/applications';

test('target WeChat is unavailable until installed, configured and granted; revocation and tampering stop tools', {skip:process.platform!=='win32'},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'cagent-wechat-')),runtime=join(directory,'runtime');
 await mkdir(join(runtime,'cshell_wechat'),{recursive:true});
 const files={'python.exe':'fixture','cshell_wechat/desktop.py':'fixture'};
 for(const [name,value] of Object.entries(files))await writeFile(join(runtime,name),value);
 await writeFile(join(runtime,'files.json'),JSON.stringify(Object.fromEntries(Object.entries(files).map(([name,value])=>[name,capabilityDigest(value)]))));
 let authorized=true;
 const capability=await createWechatCapability({directory,runtime,authorize:owner=>authorized&&owner==='controller-a'});
 const vault=new ClientVault(directory,{encrypt:async value=>Buffer.from(value).toString('base64'),decrypt:async value=>Buffer.from(value,'base64').toString()});
 const packages=new CapabilityRuntime({directory,vault,applications:{} as AgentApplicationService,agentVersion:'0.6.32',extraPackages:capability.extraPackages});
 try{
  await packages.load();assert.equal(packages.catalog().find(p=>p.id==='cagent.wechat')?.installed,false);
  await packages.install({id:'cagent.wechat',confirm:true});
  assert.equal(packages.list()[0].status,'not-configured');assert.equal(packages.tools().length,0);
  capability.service.ready=async()=>true;
  capability.service.status=async()=>({config:{} as any,processes:[],subscriptions:[],machine:'target-fixture'});
  await packages.grant({id:'cagent.wechat',permissions:['wechat.read']});
  assert(packages.tools().some(t=>t.id==='wechat_history'));
  assert(!packages.tools().some(t=>t.id==='wechat_send_text'));
  const call={packageId:'cagent.wechat',toolId:'wechat_status',args:{}};
  assert.equal((await packages.invoke(call,'controller-a',new AbortController().signal) as any).machine,'target-fixture');
  await assert.rejects(packages.invoke(call,'controller-b',new AbortController().signal),/撤权/);
  await assert.rejects(packages.invoke({...call,args:{unexpected:true}},'controller-a',new AbortController().signal));
  authorized=false;await assert.rejects(packages.invoke(call,'controller-a',new AbortController().signal),/撤权/);
  await writeFile(join(runtime,'python.exe'),'tampered');
  await packages.refresh({id:'cagent.wechat'});assert.equal(packages.list()[0].status,'fault');assert.equal(packages.tools().length,0);
 }finally{await packages.dispose();await capability.shutdown();await rm(directory,{recursive:true,force:true});}
});
