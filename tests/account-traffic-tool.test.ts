import test from 'node:test';
import assert from 'node:assert/strict';
import {accountTrafficTool} from '../src/core/account-traffic-tool';
import {apiApplicationCapabilities} from '../src/shared/contracts';
const snapshot={period:'2026-11',timezone:'UTC',periodStartsAt:1,periodEndsAt:2,updatedAt:1,channels:['relay','mcp'].map(category=>({category,ingressBytes:1,egressBytes:2,usedBytes:3,reservedBytes:4,baseLimitBytes:null,addonBytes:0,limitBytes:null,remainingBytes:null}))};
test('traffic tool preserves null entitlement and explicit capability, rejects account switch and revocation',async()=>{
 let account:string|undefined='a',calls=0,switchAccount=false;
 const tool=accountTrafficTool({accountId:()=>account,traffic:async()=>{calls++;if(switchAccount)account='b';return snapshot;}});
 assert.equal(tool.capability,'account.read');assert.ok(apiApplicationCapabilities.includes('account.read'));
 assert.equal(JSON.parse(await tool.invoke({},new AbortController().signal) as string).channels[0].limitBytes,null);
 await assert.rejects(tool.invoke({account:'b'},new AbortController().signal));assert.equal(calls,1);
 await assert.rejects(tool.invoke({},new AbortController().signal,undefined,()=>{throw Error('revoked');}),/revoked/);assert.equal(calls,1);
 switchAccount=true;await assert.rejects(tool.invoke({},new AbortController().signal),/Account changed/);
 account=undefined;await assert.rejects(tool.invoke({},new AbortController().signal),/Sign in/);
 const controller=new AbortController();controller.abort();account='a';await assert.rejects(tool.invoke({},controller.signal));assert.equal(calls,2);
});
