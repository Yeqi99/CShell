import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, createConnection, type Socket } from 'node:net';
import { createSocket } from 'node:dgram';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { DesktopSession, type DesktopSessionBinding } from '../src/agent/desktop-session';

async function pair(options:{generationMismatch?:boolean;idleMs?:number;transport?:'udp'|'tcp'}={}){
 const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');
 const incoming=once(server,'connection');const client=createConnection((server.address() as {port:number}).port,'127.0.0.1');
 const [host]=await incoming as [Socket];server.close();
 return make(client,host,options);
}
function make(client:Socket,host:Socket,options:{generationMismatch?:boolean;idleMs?:number;transport?:'udp'|'tcp'}){
 const keys=Array.from({length:4},()=>randomBytes(32));const session=randomBytes(8);
 const binding:DesktopSessionBinding={localIdentity:'viewer',peerIdentity:'host',generation:'fresh-generation',session,sendControlKey:keys[0],receiveControlKey:keys[1],sendMediaKey:keys[2],receiveMediaKey:keys[3],peerAddress:'127.0.0.1'};
 let granted=true,released=0;
 const common={transport:options.transport,authorized:()=>granted,release:()=>{released++;},idleMs:options.idleMs??2000};
 const a=new DesktopSession({...common,control:client,binding});
 const b=new DesktopSession({...common,control:host,binding:{...binding,localIdentity:'host',peerIdentity:'viewer',generation:options.generationMismatch?'old-generation':binding.generation,sendControlKey:keys[1],receiveControlKey:keys[0],sendMediaKey:keys[3],receiveMediaKey:keys[2]}});
 return {a,b,client,host,revoke:()=>{granted=false;},released:()=>released};
}
async function start(a:DesktopSession,b:DesktopSession){const ready=Promise.all([once(a,'ready'),once(b,'ready')]);await Promise.all([a.start(),b.start()]);await ready;}

test('actual loopback encrypted UDP media and reliable controls, locked peer', {timeout:5000},async()=>{
 const {a,b}=await pair();try{
  await start(a,b);const frame=once(b,'frame');const data=randomBytes(6000);
  assert.equal(await a.sendFrame({id:0n,timestamp:11n,key:true,data}),true);
  assert.deepEqual((await frame)[0].data,data);
  const pong=once(a,'pong');a.ping();await pong;
  const key=once(a,'keyframe');b.requestKeyframe();await key;
  const attacker=createSocket('udp4');await new Promise<void>(resolve=>attacker.send(Buffer.alloc(60),b.localPort,'127.0.0.1',()=>resolve()));attacker.close();
  await new Promise(resolve=>setTimeout(resolve,20));assert.equal(b.stats.wrongPeer,1);
  assert.equal(b.mediaStats.completedFrames,1);
 }finally{await Promise.all([a.close(),b.close()]);}
});
test('mismatched generation cannot establish a session',{timeout:5000},async()=>{
 const {a,b}=await pair({generationMismatch:true});const closed=once(a,'closed');
 await Promise.all([a.start(),b.start()]);await closed;assert.equal(a.ready,false);assert.equal(b.ready,false);
 await Promise.all([a.close(),b.close()]);
});
test('revocation releases each owner once and rejects further sends',{timeout:5000},async()=>{
 const {a,b,revoke,released}=await pair();await start(a,b);revoke();
 assert.equal(await a.sendFrame({id:0n,timestamp:0n,key:true,data:Buffer.from('x')}),false);
 await Promise.all([a.close(),a.close(),b.close()]);assert.equal(released(),2);assert.equal(a.ready,false);
});
test('idle timeout releases control and UDP endpoints',{timeout:5000},async()=>{
 const {a,b,released}=await pair({idleMs:60});await start(a,b);const closed=await once(a,'closed');
 assert.ok(['IDLE_TIMEOUT','CONTROL_CLOSED'].includes(closed[0]));await Promise.all([a.close(),b.close()]);assert.equal(released(),2);
});
test('replayed authenticated control record closes the session',{timeout:5000},async()=>{
 const {a,b,host,client}=await pair();let hello:Buffer|undefined;host.once('data',data=>{hello=Buffer.from(data);});
 await start(a,b);assert.ok(hello);const closed=once(b,'closed');client.write(hello);
 assert.equal((await closed)[0],'CONTROL_AUTH_OR_PROTOCOL');await Promise.all([a.close(),b.close()]);
});
test('one in-flight frame rejects another rather than queuing it',{timeout:5000},async()=>{
 const {a,b}=await pair();await start(a,b);
 try{const sending=a.sendFrame({id:0n,timestamp:0n,key:true,data:randomBytes(32000)});
 assert.equal(await a.sendFrame({id:1n,timestamp:0n,key:false,data:randomBytes(100)}),false);
 assert.equal(await sending,true);assert.equal(a.stats.droppedBusy,1);
 }finally{await Promise.all([a.close(),b.close()]);}
});


test('TCP media shares encrypted ordered stream without UDP and rejects invalid record bounds',{timeout:5000},async()=>{
 const {a,b,client}=await pair({transport:'tcp'});try{await start(a,b);assert.throws(()=>a.localPort);const received=once(b,'frame');const data=randomBytes(256*1024);assert.equal(await a.sendFrame({id:0n,timestamp:123n,key:true,data}),true);assert.deepEqual((await received)[0].data,data);const pong=once(a,'pong');a.ping();await pong;const closed=once(b,'closed');const invalid=Buffer.alloc(4);invalid.writeUInt32BE(0x80010000);client.write(invalid);assert.equal((await closed)[0],'CONTROL_LENGTH');}finally{await Promise.all([a.close(),b.close()]);}
});


test('confirmed input waits for actual remote completion and rejects close without replay',{timeout:10000},async()=>{
 const {a,b}=await pair({transport:'tcp',idleMs:8000});await start(a,b);
 try{
  let reply!: (ok:boolean)=>void;const received=once(b,'confirmed-input');let completed=false;
  const pending=a.inputConfirmed({kind:'move',x:.3,y:.4,generation:1,sequence:1}).then(()=>{completed=true;});
  const [value,respond]=await received;reply=respond;assert.equal(value.sequence,1);assert.equal(completed,false);
  reply(true);await pending;assert.equal(completed,true);
  const rejected=once(b,'confirmed-input');const bad=a.inputConfirmed({kind:'key',code:30,down:false,generation:1,sequence:2});
  const fail=assert.rejects(bad,/rejected/);(await rejected)[1](false);await fail;
  const last=once(b,'confirmed-input');const lost=a.inputConfirmed({kind:'move',x:.5,y:.5,generation:1,sequence:3});const loss=assert.rejects(lost,/disconnected/);await last;await a.close();await loss;
 }finally{await Promise.all([a.close(),b.close()]);}
});
