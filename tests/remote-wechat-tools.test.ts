import test from 'node:test';
import assert from 'node:assert/strict';
import {remoteWechatTools} from '../src/core/remote-wechat-tools';

test('remote WeChat uses the target RPC, exact schemas and trusted review; never falls back locally',{skip:process.platform!=='win32'},async()=>{
 const calls:any[]=[];
 const tools=await remoteWechatTools(async call=>{
  calls.push(call);
  if(call.method==='packages.tools')return [
   {packageId:'cagent.wechat',id:'wechat_send_text',permissions:['wechat.send'],sideEffect:false},
   {packageId:'untrusted',id:'wechat_contacts',permissions:['wechat.read'],sideEffect:false},
  ];
  throw new Error('remote offline');
 },new AbortController().signal);
 assert.deepEqual(tools.map(t=>t.name),['remote_wechat_send_text']);assert.equal(tools[0].needsReview({}),true);
 await assert.rejects(tools[0].invoke({recipient:'nickname',text:'x',idempotencyKey:'abcdefgh'},new AbortController().signal));
 assert.equal(calls.length,1);
 await assert.rejects(tools[0].invoke({recipient:'filehelper',text:'x',idempotencyKey:'abcdefgh'},new AbortController().signal),/remote offline/);
 assert.equal(calls[1].method,'packages.invoke');assert.equal(calls[1].params.packageId,'cagent.wechat');
});
