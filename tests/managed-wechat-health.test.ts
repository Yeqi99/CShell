import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readWechatHealth,wechatHealthTools} from '../src/agent/managed-wechat-health';

test('pending validation exposes only the authenticated package health contract',async()=>{
  const id='cagent.wechat.v42012',version='0.1.4',signal=new AbortController().signal;
  const pack={entry:{id,version},status:()=>({configured:true,running:false,validationUnknown:false}),
    processes:async()=>({bound:true,validation:{valid:false},account:'private'})};
  const record={id,version,status:'not-configured',grants:['wechat.api']};
  const input={packageId:id,toolId:'wechat_health',args:{}};
  assert.deepEqual(wechatHealthTools([record],[pack]).map(t=>t.id),['wechat_health']);
  assert.deepEqual(await readWechatHealth([record],[pack],input,signal),{version,state:'validation_pending',running:false});
  assert.deepEqual(wechatHealthTools([{...record,version:'0.1.2'}],[pack]),[]);
  await assert.rejects(readWechatHealth([{...record,grants:[]}],[pack],input,signal));
  await assert.rejects(readWechatHealth([record],[pack],{...input,args:{send:true}},signal));
});

test('a validated process and running HTTP transport do not imply the subscription is listening',async()=>{
  const id='cagent.wechat.v42012',version='0.1.6';
  let listener='cleanup-unconfirmed';
  const pack={entry:{id,version},status:()=>({configured:true,running:true,validationUnknown:false,settings:{subscriptionEnabled:true}}),
    processes:async()=>({bound:true,validation:{valid:true}}),listenerState:async()=>listener};
  const record={id,version,status:'available',grants:['wechat.api','wechat.events.read']};
  const read=()=>readWechatHealth([record],[pack],{packageId:id,toolId:'wechat_health',args:{}},new AbortController().signal);
  assert.equal((await read())?.state,'listener_cleanup_unknown');
  listener='starting';
  assert.equal((await read())?.state,'listener_starting');
  listener='listening';
  assert.equal((await read())?.state,'ready');
});
