import test from 'node:test';
import assert from 'node:assert/strict';
import {createMemberDomainTools} from '../src/core/member-domain-tools';
import {aiPolicySchema} from '../src/shared/ai';
import {apiApplicationCapabilities} from '../src/shared/contracts';

test('domain tools expose separate read/write capabilities and strict idempotent schemas',async()=>{
 const calls:unknown[]=[];
 const tools=createMemberDomainTools({accountId:()=> 'a',domains:async input=>{calls.push(input);return {namespace:'alice.canp.site',records:[]} as any;}});
 assert.equal(tools.length,8);
 assert.ok(tools.filter(t=>t.name.startsWith('list_')).every(t=>t.capability==='domains.read'&&!t.needsReview({})));
 const claim=tools.find(t=>t.name==='claim_member_domain')!;
 assert.equal(claim.capability,'domains.manage');assert.equal(claim.needsReview({}),true);
 await assert.rejects(claim.invoke({prefix:'alice'},new AbortController().signal));
 await assert.rejects(claim.invoke({prefix:'alice',requestId:'valid-id-001',account:'other'},new AbortController().signal));
 await claim.invoke({prefix:'alice',requestId:'valid-id-001'},new AbortController().signal);
 assert.deepEqual(calls,[{action:'claim',prefix:'alice',requestId:'valid-id-001'}]);
 assert.ok(apiApplicationCapabilities.includes('domains.manage'));
 assert.ok(aiPolicySchema.shape.application.element.options.includes('domains.read'));
});

test('domain tools guard before side effects, propagate cancellation and reject switched accounts',async()=>{
 let account:string|undefined='a',calls=0;
 const controller=new AbortController();
 const tools=createMemberDomainTools({accountId:()=>account,domains:async(_input,signal)=>{calls++;assert.equal(signal,controller.signal);account='b';return {} as any;}});
 await assert.rejects(tools.find(t=>t.name==='list_member_domains')!.invoke({},controller.signal,undefined,()=>{throw Error('revoked');}),/revoked/);assert.equal(calls,0);
 await assert.rejects(tools.find(t=>t.name==='list_member_domains')!.invoke({},controller.signal),/账号已切换/);
 controller.abort();await assert.rejects(tools.find(t=>t.name==='list_member_domains')!.invoke({},controller.signal));assert.equal(calls,1);
 account=undefined;await assert.rejects(tools.find(t=>t.name==='list_member_domains')!.invoke({},new AbortController().signal),/登录/);assert.equal(calls,1);
});
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {Store} from '../src/core/store';
import {McpService} from '../src/core/mcp';

test('real MCP HTTP domain tools enforce application grants',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'domain-mcp-'));
 const store=new Store(dir,{encrypt:async v=>Buffer.from(v).toString('base64'),decrypt:async v=>Buffer.from(v,'base64').toString()});await store.load();
 const calls:unknown[]=[];const tools=createMemberDomainTools({accountId:()=> 'a',domains:async input=>{calls.push(input);return {namespace:'alice.canp.site',records:[]} as any;}});
 const service=new McpService(store,dir,async()=>true,{applicationTools:tools} as any);
 const socket=createServer();await new Promise<void>(r=>socket.listen(0,'127.0.0.1',r));const port=(socket.address() as any).port;await new Promise<void>(r=>socket.close(()=>r()));
 try{
  await service.configure({...store.mcpSettings(),enabled:true,port,applicationCapabilities:['domains.read'],review:'authorized'});
  const token=await service.accessToken();
  const call=async(name:string,args={})=>{const r=await fetch(`http://127.0.0.1:${port}/api/v1/invoke`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Connection:'close'},body:JSON.stringify({name,arguments:args})});return {status:r.status,body:await r.json()};};
  assert.equal((await call('list_member_domains')).status,200);
  assert.notEqual((await call('claim_member_domain',{prefix:'alice',requestId:'mcp-claim-01'})).status,200);assert.equal(calls.length,1);
  await service.configure({...store.mcpSettings(),applicationCapabilities:['domains.read','domains.manage']});
  assert.equal((await call('claim_member_domain',{prefix:'alice',requestId:'mcp-claim-01'})).status,200);assert.equal(calls.length,2);
  assert.equal((await call('member_site_workflow',{domain:'alice.canp.site',target:'test-machine'})).status,200);
 }finally{await service.stop();await rm(dir,{recursive:true,force:true});}
});

test('short DNS names use the prefix of the record being edited; switching account cancels the write',async()=>{
 const id='b9d14623-9ee6-4866-a304-4f00243cbadd', writes:any[]=[];let account='one',switchAtRead=false;
 const t=createMemberDomainTools({accountId:()=>account,domains:async(input)=>{if(input)writes.push(input);else if(switchAtRead)account='two';return {records:[{id,prefix:'alice'}]} as any;}}).find(t=>t.name==='update_member_dns_record')!;
 const args={id,name:'www',type:'A',content:'192.0.2.1',requestId:'unique-id-01'};
 await t.invoke(args,new AbortController().signal);assert.equal(writes[0].name,'www.alice.canp.site');
 switchAtRead=true;await assert.rejects(t.invoke(args,new AbortController().signal),/账号已切换/);assert.equal(writes.length,1);
});
