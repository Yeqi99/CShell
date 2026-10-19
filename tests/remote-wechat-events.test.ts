import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {RemoteWechatEvents,remoteWechatSource,type RemoteEventTarget} from '../src/core/remote-wechat-events';
import type {AiPluginEvent} from '../src/shared/ai-events';

function fixture(){
 const id=randomUUID(),events:AiPluginEvent[]=[],calls:any[]=[];let saved:Record<string,string>={},active=true,denied=false,gap=false,failIngest=false;
 const target:RemoteEventTarget={sessionId:'session-a',identity:'device-a/certificate-a',label:'Machine A',call:async call=>{
  calls.push(call);if(denied)throw new Error('denied');const p=call.params as any;
  if(p.toolId==='wechat_subscriptions')return [{id,accountId:'wxid_owner',state:'listening',targets:['filehelper']}];
  if(p.toolId==='wechat_events')return {events:p.args.cursor?[]:[{kind:'message',messageId:'1',senderId:'filehelper',recipientId:'wxid_owner',conversationId:'filehelper',conversationType:'private',nativeType:1,timestampRaw:String(Math.floor(Date.now()/1000)),text:'hello',format:'text',secret:'not-forwarded'}],nextCursor:'next',gap,listenerState:'listening'};
  return {id};
 }};
 const host={targets:()=>active?[target]:[],ingest:async(event:AiPluginEvent)=>{if(failIngest)throw new Error('journal failure');events.push(event);},load:async()=>saved,save:async(c:Record<string,string>)=>{saved=c;}};
 return {id,target,events,calls,host,service:new RemoteWechatEvents(host),setActive:(v:boolean)=>active=v,setDenied:(v:boolean)=>denied=v,setGap:(v:boolean)=>gap=v,setFail:(v:boolean)=>failIngest=v,getSaved:()=>saved};
}
test('remote delivery scopes identity, persists cursor after ingestion and resumes without replay',async()=>{
 const f=fixture();await f.service.init();await f.service.tick();assert.equal(f.events.length,1);assert.equal(f.events[0].source,remoteWechatSource(f.target.identity));assert.equal(JSON.stringify(f.events).includes('not-forwarded'),false);
 assert.equal(f.service.authorized(f.events[0].source,f.id,'wxid_other','filehelper'),false);
 assert.equal(f.service.authorized(f.events[0].source,f.id,'wxid_owner','filehelper'),true);
 const restarted=new RemoteWechatEvents(f.host);await restarted.init();await restarted.tick();assert.equal(f.events.length,1);assert.equal(Object.values(f.getSaved())[0],'next');
 assert.notEqual(remoteWechatSource('device-b'),f.events[0].source);
});
test('disconnect and remote revocation immediately disable authorization and subscriptions',async()=>{
 const f=fixture();await f.service.init();await f.service.tick();const source=f.events[0].source;
 f.setActive(false);assert.equal(f.service.authorized(source,f.id,'wxid_owner','filehelper'),false);assert.deepEqual(f.service.subscriptions(),[]);
 f.setActive(true);f.setDenied(true);await f.service.tick();assert.equal(f.service.sources()[0].available,false);assert.equal(f.service.authorized(source,f.id,'wxid_owner','filehelper'),false);
});
test('failed ingest does not advance cursor, gaps remain visible without discarding retained messages',async()=>{
 const f=fixture();await f.service.init();f.setFail(true);await f.service.tick();assert.deepEqual(f.getSaved(),{});
 f.setFail(false);f.setGap(true);await f.service.tick();assert.equal(f.events.length,1);assert.match(f.service.sources()[0].reason!,/缺口/);assert.equal(f.service.sources()[0].available,true);
});
test('listener startup is explicit and bound to selected remote source',async()=>{
 const f=fixture();await f.service.init();await f.service.tick();assert.equal(f.calls.some(c=>c.params.toolId==='wechat_subscribe'),false);
 await f.service.start(remoteWechatSource(f.target.identity),{targets:['filehelper'],leaseSeconds:60});assert.equal(f.calls.at(-1).params.toolId,'wechat_subscribe');
 f.service.close();await assert.rejects(()=>f.service.start(remoteWechatSource(f.target.identity),{}));
});
test('cursor storage failure fails closed instead of advancing an unpersisted checkpoint',async()=>{
 const f=fixture();const service=new RemoteWechatEvents({...f.host,save:async()=>{throw new Error('disk full');}});
 await service.init();await service.tick();const count=f.calls.length;await service.tick();assert.equal(f.calls.length,count);
 assert.equal(service.authorized(remoteWechatSource(f.target.identity),f.id,'wxid_owner','filehelper'),false);
});
