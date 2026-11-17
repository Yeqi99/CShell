import test from 'node:test';import assert from 'node:assert/strict';
import {remoteCapabilityTools,packageDiscovery} from '../src/core/remote-capability-tools';
test('agent can collect a queued directory result by its original operation id',async()=>{
 const id='a'.repeat(32);
 const reader={...definition,id:'wechat_operation',packageId:'cagent.wechat.v42012',
   permissions:['wechat.api'],inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false}};
 const signal=new AbortController().signal;
 const tools=await remoteCapabilityTools(async req=>{
   if(req.method==='packages.tools')return [reader];
   assert.equal(req.method,'packages.invoke');
   assert.deepEqual((req.params as any).args,{id});
   return {state:'completed',items:[]};
 },true,signal);
 const lookup=tools.find(tool=>tool.name==='agent_wechat_operation')!;
 assert.deepEqual(JSON.parse(await lookup.invoke({id},signal)),{state:'completed',items:[]});
});
test('versioned directory reader forwards the cursor and rechecks the remote grant',async()=>{
 const reader={...definition,packageId:'cagent.wechat.v42012',id:'wechat_contacts',
   permissions:['wechat.api','wechat.contacts.read'],inputSchema:{type:'object',additionalProperties:true}};
 let current=[reader];const signal=new AbortController().signal;
 const tools=await remoteCapabilityTools(async req=>{
   if(req.method==='packages.tools')return current;
   assert.equal(req.method,'packages.invoke');
   assert.deepEqual((req.params as any).args.params,{limit:25,cursor:'next'});
   return {id:'queued'};
 },true,signal);
 const contacts=tools.find(t=>t.name==='agent_wechat_contacts')!;
 assert.equal(await contacts.invoke({limit:25,cursor:'next'},signal),'{"id":"queued"}');
 current=[];
 await assert.rejects(contacts.invoke({},signal),/revoked/);
});
test('same session recovers WeChat tools after catalog timeout and removes revoked sender',async()=>{
 let mode='timeout';const calls:string[]=[];
 const discovery=packageDiscovery(async req=>{
   calls.push(req.method);
   if(mode==='timeout')throw Error('catalog timeout');
   return mode==='installed'?[{...definition,packageId:'cagent.wechat.v42012',id:'wechat_send',permissions:['wechat.api','wechat.send'],sideEffect:true}]:[];
 },true);
 const signal=new AbortController().signal;
 await assert.rejects(discovery.refresh(signal),/timeout/);
 const [retry]=discovery.tools();
 mode='installed';await retry.invoke({},signal);
 assert.ok(discovery.tools().some(t=>t.name==='agent_wechat_send_text'));
 mode='revoked';await retry.invoke({},signal);
 assert.ok(!discovery.tools().some(t=>t.name==='agent_wechat_send_text'));
 assert.deepEqual(calls,['packages.tools','packages.tools','packages.tools']);
});
test('contact lookup collects the actual page and preserves ambiguous recipients and cursors',async()=>{
 const make=(id:string,permissions:string[])=>({...definition,id,packageId:'cagent.wechat.v42012',permissions,inputSchema:{type:'object',additionalProperties:true}});
 const signal=new AbortController().signal;
 const tools=await remoteCapabilityTools(async req=>{
   if(req.method==='packages.tools')return [make('wechat_contacts',['wechat.api','wechat.contacts.read']),make('wechat_operation',['wechat.api'])];
   const params=(req as any).params;
   if(params.toolId==='wechat_contacts'){assert.deepEqual(params.args.params,{limit:100,cursor:'first'});return {id:'a'.repeat(32)};}
   return {state:'completed',result:{items:[{id:'a',name:'Canper',deleteFlag:'0'},{id:'b',remark:'canper',deleteFlag:0},{id:'c',alias:'Canper',deleteFlag:1}],hasMore:true,nextCursor:'next'}};
 },true,signal);
 const search=tools.find(tool=>tool.name==='agent_wechat_find_contact')!;
 const page=JSON.parse(await search.invoke({query:'Canper',cursor:'first'},signal));
 assert.deepEqual(page.items.map((row:any)=>row.id),['a','b']);assert.equal(page.nextCursor,'next');assert.equal(page.hasMore,true);
 const resumed=JSON.parse(await search.invoke({query:'Canper',operationId:'a'.repeat(32)},signal));
 assert.deepEqual(resumed,page);
});
test('address book browsing requests each page unfiltered on the bound machine',async()=>{
 const signal=new AbortController().signal;
 const reader={...definition,packageId:'cagent.wechat.v42012',id:'wechat_contacts',
   permissions:['wechat.api','wechat.contacts.read'],inputSchema:{type:'object',additionalProperties:true}};
 const pages:unknown[]=[];
 const tools=await remoteCapabilityTools(async req=>{
   if(req.method==='packages.tools')return [reader];
   assert.equal(req.method,'packages.invoke');
   const request=req.params as {toolId:string,args:{params:unknown}};
   assert.equal(request.toolId,'wechat_contacts');
   pages.push(request.args.params);
   return {id:'a'.repeat(32)};
 },true,signal);
 const list=tools.find(tool=>tool.name==='agent_wechat_contacts')!;
 await list.invoke({},signal);
 await list.invoke({cursor:'next',limit:25},signal);
 assert.deepEqual(pages,[{limit:50},{limit:25,cursor:'next'}]);
});
test('contact lookup sends a native search to adapters that advertise it',async()=>{
 const signal=new AbortController().signal;
 const contact={...definition,packageId:'cagent.wechat.v42012',id:'wechat_contacts',
   permissions:['wechat.api','wechat.contacts.read'],inputSchema:{type:'object',properties:{
     params:{type:'object',properties:{query:{type:'string'}}},idempotencyKey:{type:'string'}}}};
 const operation={...contact,id:'wechat_operation',permissions:['wechat.api'],inputSchema:{type:'object',additionalProperties:true}};
 const tools=await remoteCapabilityTools(async req=>{
   if(req.method==='packages.tools')return [contact,operation];
   assert.equal(req.method,'packages.invoke');
   const params=req.params as {toolId:string,args:{params:{query:string}}};
   if(params.toolId==='wechat_contacts'){
     assert.equal(params.args.params.query,'西红柿');
     return {id:'a'.repeat(32)};
   }
   return {state:'completed',result:{items:[{name:'西红柿',id:'match',deleteFlag:'0'}],hasMore:false}};
 },true,signal);
 const search=tools.find(tool=>tool.name==='agent_wechat_find_contact')!;
 const page=JSON.parse(await search.invoke({query:'西红柿'},signal));
 assert.equal(page.items[0].id,'match');
});
test('machine WeChat sender uses the installed grant, exact recipient and stable key',async()=>{
 const signal=new AbortController().signal;
 const sender={...definition,id:'wechat_send',packageId:'cagent.wechat.v42012',sideEffect:true,
   permissions:['wechat.api','wechat.send'],inputSchema:{type:'object',additionalProperties:true}};
 let current=[sender];
 const sent:unknown[]=[];
 const call=async(input:any)=>{
   if(input.method==='packages.tools')return current;
   sent.push(input.params);
   return {id:'a'.repeat(32)};
 };
 const tool=(await remoteCapabilityTools(call,true,signal)).find(t=>t.name==='agent_wechat_send_text')!;
 const args={recipient:'filehelper',text:'测试',idempotencyKey:'request-0001'};
 assert.equal(tool.needsReview(args),true);
 await tool.invoke(args,signal);
 assert.deepEqual(sent,[{packageId:sender.packageId,toolId:sender.id,args:{params:args,idempotencyKey:args.idempotencyKey}}]);
 await assert.rejects(tool.invoke({...args,text:'界'.repeat(1400)},signal));
 await assert.rejects(tool.invoke({...args,recipient:'*'},signal));
 current=[];
 await assert.rejects(tool.invoke(args,signal),/revoked/);
 assert.equal(sent.length,1);
 assert.ok(!(await remoteCapabilityTools(call,true,signal)).some(t=>t.name===tool.name));
});
const definition={packageId:'cagent.example',id:'custom_action',description:'Custom native package',permissions:['agent.manage'],sideEffect:false,inputSchema:{type:'object',properties:{name:{type:'string'}},required:['name'],additionalProperties:false},outputSchema:{type:'object'}};
test('generic package tools paginate contracts and always review invocation despite remote sideEffect false',async()=>{
 const catalog=Array.from({length:12},(_,i)=>({...definition,id:'custom_'+i}));const calls:any[]=[];
 const call=async(input:any)=>{calls.push(input);return input.method==='packages.tools'?catalog:{ok:true};};const signal=new AbortController().signal;
 const tools=await remoteCapabilityTools(call,true,signal),page=JSON.parse(await tools[0].invoke({},signal));assert.equal(page.tools.length,10);assert.equal(page.nextCursor,10);assert.equal(tools[1].capability,'commands.execute');assert.equal(tools[1].needsReview({}),true);
 await tools[1].invoke({packageId:definition.packageId,toolId:page.tools[0].id,contractDigest:page.tools[0].contractDigest,args:{name:'test'}},signal);assert.equal(calls.at(-1).method,'packages.invoke');assert.equal(calls.at(-1).params.packageId,'cagent.example');
 assert.ok((await remoteCapabilityTools(call,false,signal)).every(t=>!t.needsReview({})));
});
test('revoked or replaced package cannot execute after discovery, and unavailable metadata rejects registration',async()=>{
 let catalog:any[]=[definition],invocations=0;const signal=new AbortController().signal;const call=async(input:any)=>input.method==='packages.tools'?catalog:(invocations++,{});
 const tools=await remoteCapabilityTools(call,true,signal),tool=JSON.parse(await tools[0].invoke({},signal)).tools[0],args={packageId:tool.packageId,toolId:tool.id,contractDigest:tool.contractDigest,args:{name:'test'}};
 catalog=[];await assert.rejects(tools[1].invoke(args,signal),/revoked/);assert.equal(invocations,0);
 catalog=[{...definition,description:'changed'}];await assert.rejects(tools[1].invoke(args,signal),/changed/);assert.equal(invocations,0);
 catalog=[definition,definition];await assert.rejects(remoteCapabilityTools(call,true,signal),/Duplicate/);
 await assert.rejects(remoteCapabilityTools(async()=>{throw Error('unsupported');},true,signal));
});

test('bot setup inspects only this target without sending or creating a rule',async()=>{const seen:string[]=[];const signal=new AbortController().signal;const tools=await remoteCapabilityTools(async v=>{seen.push(v.method);return v.method==='packages.tools'?[]:{sources:[]};},true,signal);const result=JSON.parse(await tools.find(t=>t.name==='agent_wechat_bot_setup')!.invoke({},signal));assert.equal(result.sendToolRegistered,false);assert.deepEqual(result.incoming,[]);assert.deepEqual(seen,['packages.tools','packages.tools','automation.list']);});

test('avatar writes require the bound adapter grant, account and exact staged image',async()=>{
 const signal=new AbortController().signal;
 const adapter={...definition,id:'wechat_avatar_set',packageId:'cagent.wechat.v42012',sideEffect:true,
   permissions:['wechat.api','wechat.profile.avatar.write'],inputSchema:{type:'object',additionalProperties:true}};
 let catalog=[adapter];const writes:any[]=[];
 const call=async(input:any)=>input.method==='packages.tools'?catalog:writes.push(input.params);
 const tools=await remoteCapabilityTools(call,true,signal);
 const tool=tools.find(t=>t.name==='agent_wechat_avatar_set')!;
 const params={expectedAccountId:'wxid_fixture',imagePath:'C:/stage/avatar.png',sha256:'1'.repeat(64)};
 const idempotencyKey='avatar-fixture';
 await tool.invoke({...params,idempotencyKey},signal);
 assert.deepEqual(writes[0].args,{params,idempotencyKey});
 await assert.rejects(tool.invoke({...params,imagePath:'C:/stage/avatar.jpg',idempotencyKey},signal));
 await assert.rejects(tool.invoke({...params,expectedAccountId:'Canper',idempotencyKey},signal));
 catalog=[{...adapter,permissions:['wechat.api']}];
 await assert.rejects(tool.invoke({...params,idempotencyKey},signal),/revoked|changed/);
 assert.ok(!(await remoteCapabilityTools(call,true,signal)).some(t=>t.name===tool.name));
 assert.equal(writes.length,1);
});

test('new package revisions expose only their granted lists, without confusing chats with contacts',async()=>{
 const signal=new AbortController().signal;
 const entry={...definition,packageId:'cagent.wechat.v42050',id:'wechat_conversations',permissions:['wechat.api','wechat.sessions.read']};
 const sender={...entry,id:'wechat_send',sideEffect:true,permissions:['wechat.api','wechat.send']};
 const names=(await remoteCapabilityTools(async()=>[entry,sender],true,signal)).map(tool=>tool.name);
 assert.ok(names.includes('agent_wechat_conversations'));
 assert.ok(names.includes('agent_wechat_send_text'));
 assert.ok(!names.includes('agent_wechat_contacts'));
});
