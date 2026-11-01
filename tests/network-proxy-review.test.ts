import test from 'node:test';
import assert from 'node:assert/strict';
import {connect, type Socket} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {AgentNetworkProxy} from '../src/agent/network-proxy';

async function socketAt(port:number){
  const socket=connect({host:'127.0.0.1',port});
  socket.on('error',()=>{});
  await new Promise<void>((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);});
  return socket;
}
async function channelFor(proxy:AgentNetworkProxy,id:string){
  for(let attempt=0;attempt<100;attempt++){
    const value=await proxy.call('network.proxy.poll',{id},'owner') as {channels:string[]};
    if(value.channels.length)return value.channels[0];
    await delay(10);
  }
  throw Error('Real loopback channel did not arrive');
}

test('closed source stream retains unread tail while its authenticated lease remains live',async()=>{
  const proxy=new AgentNetworkProxy(()=>true);let socket:Socket|undefined;
  try{
    const lease=await proxy.call('network.proxy.start',{},'owner') as {id:string;port:number};
    socket=await socketAt(lease.port);
    const channel=await channelFor(proxy,lease.id);
    socket.end('complete-tail-before-close');
    await delay(1200);
    const result=await proxy.call('network.proxy.read',{id:lease.id,channel},'owner') as {data:string;ended:boolean};
    assert.equal(Buffer.from(result.data,'base64').toString(),'complete-tail-before-close');
    assert.equal(result.ended,true);
  }finally{socket?.destroy();await proxy.dispose();}
});

test('revoked controller cannot keep using proxy environment or establish new application streams',async()=>{
  let allowed=true;const proxy=new AgentNetworkProxy(()=>allowed);
  try{
    const lease=await proxy.call('network.proxy.start',{},'owner') as {id:string};
    assert.match(proxy.environment().HTTP_PROXY,/^http:\/\/127\.0\.0\.1:/);
    allowed=false;
    await assert.rejects(proxy.call('network.proxy.poll',{id:lease.id},'owner'));
    assert.throws(()=>proxy.environment());
    await assert.rejects(proxy.open('127.0.0.1',9,AbortSignal.timeout(500)));
    assert.equal(proxy.configured,true,'revocation must not silently select direct mode');
  }finally{await proxy.dispose();}
});

test('disposal during persisted start leaves no listener or usable rule, and other owners cannot steal a lease',async()=>{
  let release!:()=>void,entered!:()=>void;
  const started=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r);
  const proxy=new AgentNetworkProxy(()=>true,async()=>{entered();await gate;});
  const opening=proxy.call('network.proxy.start',{},'owner');
  const rejected=assert.rejects(opening);
  await started;const closing=proxy.dispose();release();await rejected;await closing;
  await assert.rejects(proxy.call('network.proxy.start',{},'owner'));
  assert.equal(proxy.activity,0);

  const second=new AgentNetworkProxy(()=>true);
  try{
    const lease=await second.call('network.proxy.start',{},'owner') as {id:string};
    await assert.rejects(second.call('network.proxy.start',{},'other'));
    await assert.rejects(second.call('network.proxy.stop',{id:lease.id},'other'));
    assert.deepEqual(await second.call('network.proxy.poll',{id:lease.id},'owner'),{channels:[]});
  }finally{await second.dispose();}
});
