import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WechatSubscriptions } from '../src/core/wechat-subscriptions';

test('Persistent listener pushes cursors, stops on revocation and retains stopped metadata',async()=>{
 const root=await mkdtemp(join(tmpdir(),'cshell-subscriptions-'));
 const fake:any=new EventEmitter();fake.stdin=new PassThrough();fake.stdout=new PassThrough();fake.stderr=new PassThrough();
 fake.stdin.on('finish',()=>setImmediate(()=>fake.emit('close',0)));
 let allowed=true;
 const subscriptions=new WechatSubscriptions(root,'unused',((..._args:any[])=>{
  setImmediate(()=>fake.stdout.write(JSON.stringify({type:'ready',accountId:'wxid_test',cursor:'stream:1'})+'\n'));return fake;
 }) as any);
 const messages: any[]=[];subscriptions.onMessage=event=>messages.push(event);
 try {
  const active=await subscriptions.start(['filehelper'],{pid:42},60,()=>allowed,new AbortController().signal);
  assert.equal(active.state,'listening');
  await assert.rejects(subscriptions.start(['filehelper'],{},60,()=>true,new AbortController().signal),/已有/);
  const wait=subscriptions.wait(active.id,'stream:1',new AbortController().signal,1000);
  fake.stdout.write(JSON.stringify({type:'event',cursor:'stream:2'})+'\n');await wait;
  assert.equal(subscriptions.get(active.id).cursor,'stream:2');
  fake.stdout.write(JSON.stringify({type:'event',cursor:'stream:3',event:{kind:'message',messageId:'101'}})+'\n');
  fake.stdout.write(JSON.stringify({type:'event',cursor:'stream:4',event:{kind:'gap'}})+'\n');
  assert.equal(messages.length,1);assert.equal(messages[0].accountId,'wxid_test');assert.equal(messages[0].event.messageId,'101');
  allowed=false;
  fake.stdout.write(JSON.stringify({type:'event',cursor:'stream:5',event:{kind:'message',messageId:'102'}})+'\n');
  assert.equal(messages.length,1);
  await new Promise(resolve=>setTimeout(resolve,1200));
  assert.equal(subscriptions.get(active.id).state,'stopped');
  await subscriptions.stop(active.id);
  const loaded=new WechatSubscriptions(root,'unused');await loaded.load();assert.equal(loaded.get(active.id).state,'stopped');
  await loaded.stop(active.id,true);assert.equal(loaded.list().length,0);
 }finally{await subscriptions.stopAll();await rm(root,{recursive:true,force:true});}
});

test('Caller abort after ready stops the persistent child and suppresses subsequent messages',async()=>{
 const root=await mkdtemp(join(tmpdir(),'cshell-subscriptions-abort-'));
 const fake:any=new EventEmitter();fake.stdin=new PassThrough();fake.stdout=new PassThrough();fake.stderr=new PassThrough();
 let closed=false;
 fake.stdin.on('finish',()=>setImmediate(()=>{closed=true;fake.emit('close',0);}));
 const subscriptions=new WechatSubscriptions(root,'unused',(()=>{
  setImmediate(()=>fake.stdout.write(JSON.stringify({type:'ready',accountId:'wxid_test',cursor:'stream:1'})+'\n'));return fake;
 }) as any);
 const controller=new AbortController(), messages:unknown[]=[];
 subscriptions.onMessage=message=>messages.push(message);
 try {
  const active=await subscriptions.start(['filehelper'],{pid:42},60,()=>true,controller.signal);
  assert.equal(active.state,'listening');
  controller.abort(new Error('Owner disposed'));
  assert.equal(fake.stdin.writableEnded,true,'abort closes the parent lease even after start resolved');
  fake.stdout.write(JSON.stringify({type:'event',cursor:'stream:2',event:{kind:'message',messageId:'102'}})+'\n');
  assert.equal(messages.length,0);
  for(let i=0;i<100&&!closed;i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(closed,true);assert.equal(subscriptions.get(active.id).state,'stopped');
  for(let i=0;i<100;i++){
   try{assert.equal(await readFile(join(root,active.id,'cancel'),'utf8'),'stop');break;}
   catch(error){if(i===99)throw error;await new Promise(resolve=>setTimeout(resolve,5));}
  }
  await subscriptions.stop(active.id);
 }finally{await subscriptions.stopAll();await rm(root,{recursive:true,force:true});}
});
