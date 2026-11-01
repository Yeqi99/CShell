import test from 'node:test';import assert from 'node:assert/strict';
import {remoteCapabilityTools} from '../src/core/remote-capability-tools';
const definition={packageId:'cagent.example',id:'custom_action',description:'Custom native package',permissions:['agent.manage'],sideEffect:false,inputSchema:{type:'object',properties:{name:{type:'string'}},required:['name'],additionalProperties:false},outputSchema:{type:'object'}};
test('generic package tools paginate contracts and always review invocation despite remote sideEffect false',async()=>{
 const catalog=Array.from({length:12},(_,i)=>({...definition,id:'custom_'+i}));const calls:any[]=[];
 const call=async(input:any)=>{calls.push(input);return input.method==='packages.tools'?catalog:{ok:true};};const signal=new AbortController().signal;
 const tools=await remoteCapabilityTools(call,true,signal),page=JSON.parse(await tools[0].invoke({},signal));assert.equal(page.tools.length,10);assert.equal(page.nextCursor,10);assert.equal(tools[1].capability,'commands.execute');assert.equal(tools[1].needsReview({}),true);
 await tools[1].invoke({packageId:definition.packageId,toolId:page.tools[0].id,contractDigest:page.tools[0].contractDigest,args:{name:'test'}},signal);assert.equal(calls.at(-1).method,'packages.invoke');assert.equal(calls.at(-1).params.packageId,'cagent.example');
 assert.equal((await remoteCapabilityTools(call,false,signal)).length,1);
});
test('revoked or replaced package cannot execute after discovery, and unavailable metadata rejects registration',async()=>{
 let catalog:any[]=[definition],invocations=0;const signal=new AbortController().signal;const call=async(input:any)=>input.method==='packages.tools'?catalog:(invocations++,{});
 const tools=await remoteCapabilityTools(call,true,signal),tool=JSON.parse(await tools[0].invoke({},signal)).tools[0],args={packageId:tool.packageId,toolId:tool.id,contractDigest:tool.contractDigest,args:{name:'test'}};
 catalog=[];await assert.rejects(tools[1].invoke(args,signal),/revoked/);assert.equal(invocations,0);
 catalog=[{...definition,description:'changed'}];await assert.rejects(tools[1].invoke(args,signal),/changed/);assert.equal(invocations,0);
 catalog=[definition,definition];await assert.rejects(remoteCapabilityTools(call,true,signal),/Duplicate/);
 await assert.rejects(remoteCapabilityTools(async()=>{throw Error('unsupported');},true,signal));
});
