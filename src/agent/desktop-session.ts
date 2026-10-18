import { EventEmitter } from 'node:events';
import { createCipheriv, createDecipheriv,createHmac,randomBytes,timingSafeEqual } from 'node:crypto';
import { createSocket, type Socket as DatagramSocket } from 'node:dgram';
import { isIP, type Socket } from 'node:net';
import { MediaSender, MediaReceiver, type MediaFrame } from './desktop-media';
import type {NativeDesktopInput} from './desktop-native';
import type {DesktopQuality,DesktopVideoInfo} from '../shared/agent-desktop';

/** Supplied ONLY by the authenticated cagent connection. This is not a password
 * handshake or a public listener. Fresh direction-specific keys and generation
 * are required on every reconnect; never restore these from a saved session. */
export type DesktopSessionBinding = {
 localIdentity:string; peerIdentity:string; generation:string; session:Buffer;
 sendControlKey:Buffer; receiveControlKey:Buffer; sendMediaKey:Buffer; receiveMediaKey:Buffer;
 peerAddress:string;
};
type Control = {op:'close';reason:string}|{op:'hello';identity:string;generation:string;port:number;transport?:'tcp'|'udp'}|{op:'ping'|'pong';sent?:number}|{op:'keyframe'|'release-input'}|{op:'feedback';value:Record<string,number>}|{op:'input';value:NativeDesktopInput}|{op:'quality';value:DesktopQuality}|{op:'video';value:DesktopVideoInfo}|{op:'ack';id:string}|{op:'notice';value:string};
export type DesktopSessionOptions = {
 binding:DesktopSessionBinding; control:Socket;transport?:'tcp'|'udp';
 /** Backend grant recheck, including identity/account/connection revocation. */
 authorized:()=>boolean;
 bindAddress?:string;bindPort?:number;advertisedPort?:number;peerPortOverride?:number; idleMs?:number; handshakeMs?:number; frameBudgetBytes?:number;
 /** Integration must stop its capture helper and release owned input state. */
 release:()=>void|Promise<void>;
};
const CONTROL_LIMIT=8192;
export class DesktopSession extends EventEmitter {
 private udp:DatagramSocket; private sender:MediaSender; private receiver:MediaReceiver;
 private pending=Buffer.alloc(0); private tx=0n; private rx=0n; private peerPort?:number;
 private closed=false; private busy=false; private started=false; private lastSeen=performance.now();
 private pathVerified=false;private readyEmitted=false;
 private timer?:ReturnType<typeof setInterval>; private helloDeadline=0; private releasing?:Promise<void>;
 readonly stats={sentFrames:0,droppedBusy:0,wrongPeer:0,receivedFrames:0};
 constructor(private options:DesktopSessionOptions){
  super();const b=options.binding;
  if(!b.localIdentity||!b.peerIdentity||!b.generation||b.generation.length>128||b.session.length!==8||!isIP(b.peerAddress))throw new Error('Invalid authenticated desktop binding');
  const keys=[b.sendControlKey,b.receiveControlKey,b.sendMediaKey,b.receiveMediaKey];
  if(keys.some(k=>k.length!==32)||keys.some((k,i)=>keys.slice(i+1).some(v=>v.equals(k))))throw new Error('Desktop requires distinct direction and channel keys');
  const budget=options.frameBudgetBytes??32*1024*1024;
  if(!Number.isSafeInteger(budget)||budget<1||budget>64*1024*1024)throw new Error('Invalid session memory budget');
  for(const value of [options.idleMs??15000,options.handshakeMs??5000])if(!Number.isFinite(value)||value<20)throw new Error('Invalid session timeout');
  this.udp=createSocket(isIP(b.peerAddress)===6?'udp6':'udp4');
  this.sender=new MediaSender(b.sendMediaKey,b.session,options.transport==='tcp'?16384:1200);this.receiver=new MediaReceiver(b.receiveMediaKey,b.session,budget,options.transport==='tcp'?5000:150);
  this.udp.on('error',()=>void this.close('UDP_FAILURE'));
  this.udp.on('message',(packet,peer)=>{
   if(!this.check()||!this.peerPort)return;
   if(peer.address!==b.peerAddress){this.stats.wrongPeer++;return;}
   if(packet.length===64&&['CDPROBE1','CDPROBA1'].includes(packet.subarray(0,8).toString())){
    const tag=createHmac('sha256',b.receiveMediaKey).update(packet.subarray(0,32)).digest();
    if(!packet.subarray(8,16).equals(b.session)||!timingSafeEqual(tag,packet.subarray(32))){this.stats.wrongPeer++;return;}
    if(this.pathVerified&&peer.port!==this.peerPort){this.stats.wrongPeer++;return;}
    this.peerPort=peer.port;this.pathVerified=true;if(packet.subarray(0,8).toString()==='CDPROBE1')this.probe(true);this.emitReady();return;
   }
   if(!this.pathVerified||peer.port!==this.peerPort){this.stats.wrongPeer++;return;}
   const frame=this.receiver.accept(packet);
   if(frame){this.stats.receivedFrames++;this.lastSeen=performance.now();this.emit('frame',frame);}
  });
 }
 get ready(){return !this.closed&&this.peerPort!==undefined&&this.pathVerified;}
 get mediaStats(){return {...this.receiver.stats};}
 get localPort(){const address=this.udp.address();return typeof address==='string'?0:address.port;}
 async start(){
  if(this.started||this.closed)throw new Error('Desktop session cannot restart');this.started=true;
  if(!this.check())throw new Error('Desktop authorization denied');
  const c=this.options.control;
  c.on('data',this.read);c.once('close',()=>void this.close('CONTROL_CLOSED'));c.on('error',()=>void this.close('CONTROL_FAILURE'));
  if(this.options.transport!=='tcp')await new Promise<void>((resolve,reject)=>{const fail=(e:Error)=>reject(e);this.udp.once('error',fail);this.udp.bind(this.options.bindPort??0,this.options.bindAddress??(isIP(this.options.binding.peerAddress)===6?'::1':'127.0.0.1'),()=>{this.udp.off('error',fail);resolve();});});
  if(!this.check())return;
  this.helloDeadline=performance.now()+(this.options.handshakeMs??5000);
  this.send({op:'hello',identity:this.options.binding.localIdentity,generation:this.options.binding.generation,port:this.options.transport==='tcp'?0:(this.options.advertisedPort??this.localPort),transport:this.options.transport??'udp'});
  this.timer=setInterval(()=>{
   if(!this.check())return;const now=performance.now();this.receiver.expire(now);
   if(!this.ready&&now>this.helloDeadline)void this.close('HANDSHAKE_OR_UDP_PATH_TIMEOUT');
   else if(now-this.lastSeen>(this.options.idleMs??15000))void this.close('IDLE_TIMEOUT');
   else if(!this.ready&&this.options.transport!=='tcp')this.probe();
  },Math.min(250,(this.options.idleMs??15000)/2,(this.options.handshakeMs??5000)/2));
  this.timer.unref();
 }
 private probe(reply=false){if(this.options.transport==='tcp')return;if(!this.peerPort||this.closed)return;const head=Buffer.concat([Buffer.from(reply?'CDPROBA1':'CDPROBE1'),this.options.binding.session,randomBytes(16)]);const tag=createHmac('sha256',this.options.binding.sendMediaKey).update(head).digest();this.udp.send(Buffer.concat([head,tag]),this.peerPort,this.options.binding.peerAddress,()=>{});}
 private emitReady(){if(this.ready&&!this.readyEmitted){this.readyEmitted=true;this.lastSeen=performance.now();this.emit('ready');}}
 private check(){
  if(this.closed)return false;
  try{if(this.options.authorized())return true;}catch{/* Failed checks deny. */}
  void this.close('REVOKED');return false;
 }
 private send(message:Control,closing=false){
  if(!closing&&!this.check())return false;const c=this.options.control;
  const body=Buffer.from(JSON.stringify(message));
  if(body.length>CONTROL_LIMIT||c.writableLength>(this.options.transport==='tcp'?65536:CONTROL_LIMIT*2)){if(!closing)void this.close('CONTROL_BACKPRESSURE');return false;}
  if(this.tx>=0xffffffffffffffffn){if(!closing)void this.close('KEY_EXHAUSTED');return false;}
  const seq=Buffer.alloc(8);seq.writeBigUInt64BE(this.tx++);const nonce=Buffer.alloc(12);seq.copy(nonce,4);
  const cipher=createCipheriv('aes-256-gcm',this.options.binding.sendControlKey,nonce);
  cipher.setAAD(Buffer.concat([this.options.binding.session,seq]));
  const payload=Buffer.concat([seq,cipher.update(body),cipher.final(),cipher.getAuthTag()]);const length=Buffer.alloc(4);length.writeUInt32BE(payload.length);
  c.write(Buffer.concat([length,payload]));return true;
 }
 private read=(chunk:Buffer)=>{
  if(!this.check())return;
  // TCP may coalesce multiple valid records: process incrementally rather than
  // reject a large data callback or buffer it without a bound.
  for(let offset=0;offset<chunk.length;){
   const need=this.pending.length<4?4-this.pending.length:4+(this.pending.readUInt32BE(0)&0x7fffffff)-this.pending.length;
   const count=Math.min(need,chunk.length-offset);this.pending=Buffer.concat([this.pending,chunk.subarray(offset,offset+count)]);offset+=count;
   if(this.pending.length<4)continue;
   const encodedLength=this.pending.readUInt32BE(0),media=!!(encodedLength&0x80000000),length=encodedLength&0x7fffffff;
   if(length<25||length>(media?16384:CONTROL_LIMIT+24)||(media&&this.options.transport!=='tcp')){void this.close('CONTROL_LENGTH');return;}
   if(this.pending.length<length+4)continue;
   const payload=this.pending.subarray(4);this.pending=Buffer.alloc(0);
   try{
    if(media){if(!this.ready)throw new Error('Handshake required');const frame=this.receiver.accept(payload);if(frame){this.stats.receivedFrames++;this.lastSeen=performance.now();this.emit('frame',frame);}continue;}
    const seq=payload.subarray(0,8);if(seq.readBigUInt64BE()!==this.rx)throw new Error('Sequence');
    const nonce=Buffer.alloc(12);seq.copy(nonce,4);const decipher=createDecipheriv('aes-256-gcm',this.options.binding.receiveControlKey,nonce);
    decipher.setAAD(Buffer.concat([this.options.binding.session,seq]));decipher.setAuthTag(payload.subarray(-16));
    const message=JSON.parse(Buffer.concat([decipher.update(payload.subarray(8,-16)),decipher.final()]).toString());this.rx++;
    this.handle(message);
   }catch{void this.close('CONTROL_AUTH_OR_PROTOCOL');return;}
   if(this.closed)return;
  }
 };
 private handle(message:Control){
  if(!message||typeof message!=='object')throw new Error('Control');
  if(message.op==='hello'){
   if(this.peerPort!==undefined||message.identity!==this.options.binding.peerIdentity||message.generation!==this.options.binding.generation||!Number.isInteger(message.port)||message.port<(this.options.transport==='tcp'?0:1)||message.port>65535||(message.transport??'udp')!==(this.options.transport??'udp'))throw new Error('Binding mismatch');
   this.peerPort=this.options.peerPortOverride??message.port;this.lastSeen=performance.now();if(this.options.transport==='tcp'){this.pathVerified=true;this.emitReady();}else this.probe();return;
  }
  if(!this.ready)throw new Error('Handshake required');
  if(message.op==='close'){if(typeof message.reason!=='string'||! /^[A-Z][A-Z0-9_]{0,79}$/.test(message.reason))throw new Error('Invalid close reason');void this.close(message.reason,false);return;}
  if(message.op==='ping'){if(message.sent!==undefined&&(!Number.isFinite(message.sent)||message.sent<0))throw new Error('Invalid ping');this.send({op:'pong',sent:message.sent});}
  else if(message.op==='pong'){if(message.sent!==undefined&&(!Number.isFinite(message.sent)||message.sent<0||message.sent>performance.now()))throw new Error('Invalid pong');this.emit('pong',message.sent===undefined?undefined:{rttMs:performance.now()-message.sent});}
  else if(message.op==='keyframe')this.emit('keyframe');
  else if(message.op==='release-input')this.emit('release-input');
  else if(message.op==='feedback'){
   if(!message.value||Array.isArray(message.value)||Object.keys(message.value).length>16||Object.values(message.value).some(v=>typeof v!=='number'||!Number.isFinite(v)||v<0))throw new Error('Feedback');
   this.emit('feedback',message.value);
  }else if(message.op==='input'||message.op==='quality'||message.op==='video'){
   if(!message.value||typeof message.value!=='object'||Array.isArray(message.value))throw new Error('Invalid control payload');this.emit(message.op,message.value);
  }else if(message.op==='ack'){
   if(typeof message.id!=='string'||!/^\d{1,10}$/.test(message.id))throw new Error('Invalid frame acknowledgment');this.emit('ack',message.id);
  }else if(message.op==='notice'){
   if(typeof message.value!=='string'||message.value.length>1024)throw new Error('Invalid notice');this.emit('notice',message.value);
  }else throw new Error('Unsupported control operation');
  this.lastSeen=performance.now();
 }
 ping(){return this.ready&&this.send({op:'ping',sent:performance.now()});}
 requestKeyframe(){return this.ready&&this.send({op:'keyframe'});}
 feedback(value:Record<string,number>){return this.ready&&this.send({op:'feedback',value});}
 releaseInput(){return this.ready&&this.send({op:'release-input'});}
 input(value:NativeDesktopInput){return this.ready&&this.send({op:'input',value});}
 quality(value:DesktopQuality){return this.ready&&this.send({op:'quality',value});}
 video(value:DesktopVideoInfo){return this.ready&&this.send({op:'video',value});}
 ack(id:bigint){return this.ready&&this.send({op:'ack',id:String(id)});}
 notice(value:string){return this.ready&&this.send({op:'notice',value});}
 async sendFrame(frame:MediaFrame):Promise<boolean>{
  if(!this.check()||!this.ready)return false;
  if(this.busy){this.stats.droppedBusy++;return false;}
  if(frame.data.length>(this.options.frameBudgetBytes??32*1024*1024))throw new Error('Frame exceeds session budget');
  this.busy=true;
  try{
   const packets=this.sender.encode(frame);
   // Exactly one queued UDP packet at a time; no unbounded OS send backlog.
   for(const packet of packets){
    if(!this.check())return false;
    if(this.options.transport==='tcp'){
     const prefix=Buffer.alloc(4);prefix.writeUInt32BE((0x80000000+packet.length)>>>0);
     const socket=this.options.control;
     // A packet callback gates each next chunk; at most one frame exists upstream.
     await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>done(new Error('Media write timeout')),5000);const closed=()=>done(new Error('Media stream closed'));const done=(error?:Error|null)=>{clearTimeout(timer);socket.off('close',closed);error?reject(error):resolve();};socket.once('close',closed);socket.write(Buffer.concat([prefix,packet]),done);});
    }else await new Promise<void>((resolve,reject)=>this.udp.send(packet,this.peerPort!,this.options.binding.peerAddress,error=>error?reject(error):resolve()));
    // send callbacks can all run before UDP receives on Windows. Yield between
    // packets so even a local viewer is not starved by a large keyframe burst.
    await new Promise<void>(resolve=>setImmediate(resolve));
   }
   this.stats.sentFrames++;return true;
  }catch{await this.close('MEDIA_SEND_FAILURE');return false;}finally{this.busy=false;}
 }
 close(reason='CLOSED',notifyPeer=true):Promise<void>{
  if(this.releasing)return this.releasing;
  let sent=false;try{if(notifyPeer&&this.ready&&!this.options.control.destroyed)sent=this.send({op:'close',reason:/^[A-Z][A-Z0-9_]{0,79}$/.test(reason)?reason:'CLOSED'},true);}catch{}
  this.closed=true;this.peerPort=undefined;clearInterval(this.timer);this.pending=Buffer.alloc(0);
  const socket=this.options.control;socket.off('data',this.read);
  if(sent){const deadline=setTimeout(()=>socket.destroy(),1000);deadline.unref();socket.once('close',()=>clearTimeout(deadline));socket.end();}else socket.destroy();
  try{this.udp.close();}catch{/* Not bound. */}
  this.releasing=Promise.resolve().then(()=>this.options.release()).catch(()=>{this.emit('releaseFailure');}).then(()=>{this.emit('closed',reason);});
  return this.releasing;
 }
}




