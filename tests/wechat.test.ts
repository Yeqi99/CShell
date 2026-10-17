import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WechatService } from '../src/core/wechat';
import { builtinPlugins } from '../src/shared/plugins';
import { aiPolicySchema,emptyAiPolicy } from '../src/shared/ai';
import type { Store } from '../src/core/store';

test('WeChat grants are independent and disabled by default',()=>{
  const p=emptyAiPolicy();assert(!p.application.includes('wechat.send'));
  assert(aiPolicySchema.parse({...p,application:['wechat.read','wechat.send']}));
  assert(!p.application.includes('wechat.contacts.manage'));
});
test('WeChat plugin gates tools and exact recipient allowlists before subprocess',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'cshell-wechat-test-'));
  let enabled=false;
  const manifest=builtinPlugins.find(p=>p.id==='cshell.wechat')!;
  const store={plugins:()=>[{manifest,enabled,source:'bundled'}]} as unknown as Store;
  const service=new WechatService(directory,store);
  let calls=0;
  (service as any).run=async()=>{calls++;return {processes:[{pid:42,version:'4.1.15.50',binding:{pid:42,created:'1'}}]};};
  try{
    assert.equal(service.tools().length,0);enabled=true;
    if(process.platform!=='win32')return;
    const send=service.tools().find(t=>t.name==='wechat_send_text')!;
    assert(send.needsReview({}));
    await assert.rejects(send.invoke({recipient:'filehelper'},new AbortController().signal));assert.equal(calls,0);
    await service.save({enabled:true,experimental:true,pid:42,readContacts:false,send:['filehelper'],receive:[]});
    const before=calls;
    const remark=service.tools().find(t=>t.name==='wechat_set_remark')!;
    assert(remark.needsReview({}));
    await assert.rejects(remark.invoke({target:'wxid_test123'},new AbortController().signal));assert.equal(calls,before);
    const history=service.tools().find(t=>t.name==='wechat_history')!;
    await assert.rejects(history.invoke({target:'filehelper'},new AbortController().signal));assert.equal(calls,before);
    await assert.rejects(send.invoke({recipient:'wxid_other'},new AbortController().signal));assert.equal(calls,before);
    await send.invoke({recipient:'filehelper',text:'test',idempotencyKey:'test-key-123'},new AbortController().signal);assert.equal(calls,before+1);
    enabled=false;
    await assert.rejects(send.invoke({recipient:'filehelper'},new AbortController().signal));assert.equal(calls,before+1);
    const loaded=new WechatService(directory,store);await loaded.load();enabled=true;
    (loaded as any).run=async()=>({processes:[]});
    assert.deepEqual((await loaded.status()).config.send,['filehelper']);
    assert.deepEqual((await loaded.status()).config.history,[]);
    assert.deepEqual((await loaded.status()).config.remarks,[]);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('Wildcard sending respects deny precedence, exact IDs, persistence and independent scopes',async()=>{
  if(process.platform!=='win32')return;
  const directory=await mkdtemp(join(tmpdir(),'cshell-wechat-wildcard-'));
  const manifest=builtinPlugins.find(p=>p.id==='cshell.wechat')!;
  const store={plugins:()=>[{manifest,enabled:true,source:'bundled'}]} as unknown as Store;
  let calls=0;
  const service=new WechatService(directory,store);
  (service as any).run=async()=>{calls++;return {processes:[{pid:42,binding:{pid:42}}]};};
  const config={enabled:true,experimental:true,pid:42,readContacts:false,send:['*'],sendBlocked:['wxid_blocked','filehelper'],receive:[]};
  const signal=new AbortController().signal;
  const send=service.tools().find(t=>t.name==='wechat_send_text')!;
  const invoke=(recipient:string)=>send.invoke({recipient,text:'mock only',idempotencyKey:'mock-key-123'},signal);
  try{
    await service.save(config);
    const before=calls;
    for(const recipient of ['wxid_blocked','filehelper','*','nickname','wxid_*'])await assert.rejects(invoke(recipient));
    assert.equal(calls,before);
    for(const recipient of ['wxid_allowed','123456@chatroom'])await invoke(recipient);
    assert.equal(calls,before+2);
    for(const name of ['wechat_receive','wechat_history','wechat_set_remark']){
      await assert.rejects(service.tools().find(t=>t.name===name)!.invoke({targets:['wxid_allowed'],target:'wxid_allowed'},signal));
    }
    assert.equal(calls,before+2);
    const loaded=new WechatService(directory,store);await loaded.load();
    (loaded as any).run=async()=>({processes:[]});
    assert.deepEqual((await loaded.status()).config.send,['*']);
    assert.deepEqual((await loaded.status()).config.sendBlocked,config.sendBlocked);
    await service.save({...config,send:['wxid_blocked']});
    await assert.rejects(invoke('wxid_blocked'),/黑名单/);
    await service.save({...config,send:[],sendBlocked:[]});
    await assert.rejects(invoke('wxid_allowed'),/授权列表/);
    await service.save({...config,sendBlocked:[]});await invoke('filehelper');
    await assert.rejects(service.save({...config,sendBlocked:['*']}));
    await assert.rejects(service.save({...config,receive:['*']}));
    await service.save({...config,enabled:false});await assert.rejects(invoke('wxid_allowed'));
  }finally{await rm(directory,{recursive:true,force:true});}
});
