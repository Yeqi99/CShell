import {EventEmitter} from 'node:events';
import {createConnection,type Socket} from 'node:net';
import {lookup} from 'node:dns/promises';
import {DesktopSession} from '../agent/desktop-session';
import {desktopLine,desktopProof,verifyDesktopProof} from '../agent/desktop-service';
import {desktopVideoInfoSchema,type DesktopVideoInfo,type DesktopTicket,type DesktopQuality} from '../shared/agent-desktop';
import type {NativeDesktopInput} from '../agent/desktop-native';
import {desktopPercentile,type DesktopFeedback,type MediaFrame} from '../agent/desktop-media';
type InputValue<T> = T extends unknown?Omit<T,'generation'|'sequence'>:never;
export type DesktopClientInput=InputValue<NativeDesktopInput>;
/** Main process only. The renderer receives frames/metadata, never the ticket. */
export class DesktopClient extends EventEmitter {
 videoInfo?:DesktopVideoInfo;private sequence=0;private closed=false;private videoReady=false;private timer:ReturnType<typeof setInterval>;
 private rtt?:number;private jitter=0;private previousArrival?:number;private previousTimestamp?:bigint;private bytes=0;private sampleAt=performance.now();private dropped=0;private completed=0;private decode?:number;private queue?:number;private decodeSamples:number[]=[];private queueSamples:number[]=[];
 constructor(readonly session:DesktopSession,readonly controlAllowed:boolean){
  super();for(const event of ['frame','video','notice','feedback','closed'])session.on(event,(value:unknown)=>{if(event==='video'){const result=desktopVideoInfoSchema.safeParse(value);if(!result.success){void session.close('INVALID_VIDEO_METADATA');return;}this.videoReady=true;this.videoInfo=result.data;value=result.data;}if(event==='frame')this.measure(value as MediaFrame);if(event==='closed'){this.closed=true;clearInterval(this.timer);}this.emit(event,value);});
  session.on('pong',(value?:{rttMs:number})=>{if(value&&Number.isFinite(value.rttMs))this.rtt=value.rttMs;});
  this.timer=setInterval(()=>{if(!this.closed){this.publishFeedback();session.ping();if(controlAllowed&&this.videoReady)session.input({kind:'lease',generation:1,sequence:++this.sequence});}},2000);this.timer.unref();
 }
 ack(id:string|bigint){if(!/^\d{1,10}$/.test(String(id)))throw new Error('Invalid frame ID');return this.session.ack(BigInt(id));}
 input(value:DesktopClientInput){if(!this.controlAllowed||!this.videoReady)throw new Error('Desktop control is not ready or permitted');return this.session.input({...value,generation:1,sequence:++this.sequence} as NativeDesktopInput);}
 releaseInput(){return this.session.releaseInput();}
 quality(value:DesktopQuality){return this.session.quality(value);}
 requestKeyframe(){return this.session.requestKeyframe();}
 feedback(value:DesktopFeedback){return this.session.feedback(value);}
 /** Decode duration and renderer queue age must be measured by the viewer.
  * Unknown encode duration is omitted; the host merges its native measurement. */
 reportDecode(ms:number,queueMs:number){if(!Number.isFinite(ms)||ms<0||!Number.isFinite(queueMs)||queueMs<0)throw new Error('Invalid decode measurement');this.decodeSamples.push(ms);this.queueSamples.push(queueMs);if(this.decodeSamples.length>128)this.decodeSamples.shift();if(this.queueSamples.length>128)this.queueSamples.shift();this.decode=desktopPercentile(this.decodeSamples);this.queue=desktopPercentile(this.queueSamples);}
 private measure(frame:MediaFrame){const now=performance.now();this.bytes+=frame.data.length;if(this.previousArrival!==undefined&&this.previousTimestamp!==undefined&&frame.timestamp>=this.previousTimestamp){const variation=Math.abs((now-this.previousArrival)-Number(frame.timestamp-this.previousTimestamp)/1000);this.jitter+=(variation-this.jitter)/16;}this.previousArrival=now;this.previousTimestamp=frame.timestamp;}
 private publishFeedback(){if(this.rtt===undefined||this.queue===undefined||!this.videoReady)return;const now=performance.now(),elapsed=(now-this.sampleAt)/1000;if(elapsed<=0||!this.decodeSamples.length)return;const stats=this.session.mediaStats,losses=stats.droppedFrames-this.dropped,frames=stats.completedFrames-this.completed;this.session.feedback({rttMs:this.rtt,jitterMs:this.jitter,loss:losses+frames?losses/(losses+frames):0,queueMs:this.queue,...(this.decode!==undefined?{decodeMs:this.decode}:{}),deliveredBitsPerSecond:this.bytes*8/elapsed});this.decodeSamples=[];this.queueSamples=[];this.sampleAt=now;this.bytes=0;this.dropped=stats.droppedFrames;this.completed=stats.completedFrames;}
 close(){clearInterval(this.timer);return this.session.close('VIEWER_CLOSED');}
}
export async function connectDesktop(ticket:DesktopTicket,options:{host:string;expectedHostIdentity:string;local?:boolean;tcpPortOverride?:number;stream?:Socket}):Promise<DesktopClient>{
 if(ticket.hostIdentity!==options.expectedHostIdentity||ticket.expiresAt<=Date.now())throw new Error('Desktop ticket identity mismatch or expired');
 if(ticket.transport==='management'&&!options.stream)throw new Error('Authenticated Agent desktop stream required');
 const address=options.stream?.remoteAddress?.replace(/^::ffff:/,'')??(await lookup(options.host)).address;const socket=options.stream??createConnection({host:address,port:options.tcpPortOverride??(options.local?ticket.localTcpPort:ticket.tcpPort)});socket.on('error',()=>{});
 let client:DesktopClient|undefined;
 try{
  const hello=JSON.parse(await desktopLine(socket));if(hello.version!==1||typeof hello.nonce!=='string'||! /^[0-9a-f]{64}$/.test(hello.nonce))throw new Error('Invalid desktop bootstrap');
  socket.write(JSON.stringify({id:ticket.id,proof:desktopProof(ticket.keys.bootstrap,`client:${hello.nonce}:${ticket.id}`)})+'\n');
  const response=JSON.parse(await desktopLine(socket));if(!verifyDesktopProof(desktopProof(ticket.keys.bootstrap,`server:${hello.nonce}:${ticket.id}`),response.proof))throw new Error('Desktop host authentication failed');
  const session=new DesktopSession({transport:options.stream?(ticket.mediaTransport??'tcp'):'udp',handshakeMs:ticket.mediaTransport==='udp'?2500:undefined,control:socket,binding:{localIdentity:ticket.owner,peerIdentity:ticket.hostIdentity,generation:ticket.generation,session:Buffer.from(ticket.session,'hex'),sendControlKey:Buffer.from(ticket.keys.viewerControl,'hex'),receiveControlKey:Buffer.from(ticket.keys.hostControl,'hex'),sendMediaKey:Buffer.from(ticket.keys.viewerMedia,'hex'),receiveMediaKey:Buffer.from(ticket.keys.hostMedia,'hex'),peerAddress:address},bindAddress:address.includes(':')?'::':'0.0.0.0',peerPortOverride:options.local&&ticket.localUdpPort?ticket.localUdpPort:undefined,authorized:()=>true,release:()=>{}});
  client=new DesktopClient(session,ticket.control);
  const ready=new Promise<void>((resolve,reject)=>{session.once('ready',resolve);session.once('closed',(reason:string)=>reject(new Error(reason)));});
  await session.start();socket.resume();await ready;session.ping();return client;
 }catch(error){await client?.close();socket.destroy();throw error;}
}

