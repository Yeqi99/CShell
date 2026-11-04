import test from 'node:test';
import assert from 'node:assert/strict';
import {remoteAndroidTools} from '../src/core/remote-android-tools';

test('Android semantic UI is exposed only by its known contract and uses bound remote invocation',async()=>{
  const calls:unknown[]=[];
  const signal=new AbortController().signal;
  const tools=await remoteAndroidTools(async input=>{
    calls.push(input);
    return input.method==='packages.tools'?[{packageId:'cagent.android',id:'android_ui_read',permissions:['desktop.view'],sideEffect:false}]:{nodes:[],available:true};
  },signal);
  assert.equal(tools.length,1);assert.equal(tools[0].capability,'desktop.view');
  assert.equal(await tools[0].invoke({},signal),'{"nodes":[],"available":true}');
  assert.deepEqual(calls[1],{method:'packages.invoke',params:{packageId:'cagent.android',toolId:'android_ui_read',args:{}}});
  assert.throws(()=>tools[0].input.parse({command:'anything'}));
});
test('Unknown or misleading Android metadata grants no tools',async()=>{
  for(const item of [
    {packageId:'custom.android',id:'android_ui_read',permissions:['desktop.view'],sideEffect:false},
    {packageId:'cagent.android',id:'android_ui_read',permissions:['agent.manage'],sideEffect:false},
    {packageId:'cagent.android',id:'android_ui_read',permissions:['desktop.view'],sideEffect:true},
  ])assert.deepEqual(await remoteAndroidTools(async()=>[item],new AbortController().signal),[]);
});
test('SMS and phone side effects require exact permission metadata and an idempotency identifier',async()=>{
  const calls:unknown[]=[];
  const tools=await remoteAndroidTools(async input=>{
    calls.push(input);
    return input.method==='packages.tools'?[{packageId:'cagent.android',id:'android_sms_send',permissions:['commands.execute'],sideEffect:true}]:{state:'submitted',confirmed:false};
  },new AbortController().signal);
  assert.equal(tools.length,1);assert.equal(tools[0].name,'android_sms_send');
  assert.equal(tools[0].needsReview({}),true);
  assert.throws(()=>tools[0].input.parse({number:'+123456789',text:'hello'}));
  assert.throws(()=>tools[0].input.parse({number:'123; extra',text:'hello',requestId:'36f92f63-b4cc-4fa7-a29f-c27f86aad254'}));
  const args={number:'+123456789',text:'hello',requestId:'36f92f63-b4cc-4fa7-a29f-c27f86aad254'};
  assert.equal(await tools[0].invoke(args,new AbortController().signal),'{"state":"submitted","confirmed":false}');
  assert.deepEqual(calls[1],{method:'packages.invoke',params:{packageId:'cagent.android',toolId:'android_sms_send',args}});
});
