import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Session keys are exchanged inside the authenticated control connection.
// Each direction must have its own key. The receiver never accepts a new session
// ID from an unauthenticated datagram.
const HEADER=32, TAG=16, VERSION=1;
export type MediaFrame={id:bigint; timestamp:bigint; key:boolean; data:Buffer};
export class MediaSender {
 private sequence=0n;
 constructor(private key:Buffer,private session:Buffer,private datagramBytes=1200){
  if(key.length!==32||session.length!==8||!Number.isInteger(datagramBytes)||datagramBytes<=HEADER+TAG||datagramBytes>65507)throw new Error('Invalid media parameters');
 }
 encode(frame:MediaFrame):Buffer[]{
  const payload=this.datagramBytes-HEADER-TAG, count=Math.ceil(frame.data.length/payload);
  if(!count||count>65535||frame.id<0||frame.id>0xffffffffn)throw new Error('Frame exceeds wire limits; renegotiate session');
  const packets:Buffer[]=[];
  for(let index=0;index<count;index++){
   if(this.sequence>=0xffffffffffffffffn)throw new Error('Media key exhausted; renegotiate');
   const header=Buffer.alloc(HEADER);header[0]=VERSION;header[1]=frame.key?1:0;this.session.copy(header,2);
   header.writeBigUInt64BE(this.sequence++,10);header.writeUInt32BE(Number(frame.id),18);header.writeUInt16BE(index,22);header.writeUInt16BE(count,24);
   // Sender monotonic time modulo 2^48 microseconds. Client measures frame age
   // relative to control-channel clock alignment, never wall-clock subtraction.
   header.writeUIntBE(Number(frame.timestamp&0xffffffffffffn),26,6);
   const nonce=Buffer.alloc(12);header.copy(nonce,4,10,18);
   const cipher=createCipheriv('aes-256-gcm',this.key,nonce);cipher.setAAD(header);
   packets.push(Buffer.concat([header,cipher.update(frame.data.subarray(index*payload,(index+1)*payload)),cipher.final(),cipher.getAuthTag()]));
  }
  return packets;
 }
}
type Assembly={id:bigint; timestamp:bigint; key:boolean; count:number; bytes:number; first:number; parts:Map<number,Buffer>};
export class MediaReceiver {
 private assembly?:Assembly;private highestFrame=-1n;private lastCompleted=-1n;private highestSequence=-1n;private seen=new BigInt64Array(65536).fill(-1n);
 private awaitingKey=true;
 readonly stats={authenticatedPackets:0,rejectedPackets:0,droppedFrames:0,completedFrames:0};
 constructor(private key:Buffer,private session:Buffer,private budgetBytes=32*1024*1024,private maxAgeMs=150){
  if(key.length!==32||session.length!==8||budgetBytes<=0||maxAgeMs<=0)throw new Error('Invalid receiver parameters');
 }
 get needsKeyframe(){return this.awaitingKey;}
 expire(now=performance.now()){
  if(this.assembly&&now-this.assembly.first>this.maxAgeMs){this.assembly=undefined;this.awaitingKey=true;this.stats.droppedFrames++;}
 }
 accept(packet:Buffer,now=performance.now()):MediaFrame|undefined{
  this.expire(now);
  if(packet.length<=HEADER+TAG||packet.length>65507||packet[0]!==VERSION||packet[1]>1||!packet.subarray(2,10).equals(this.session))return this.reject();
  const seq=packet.readBigUInt64BE(10);
  if(this.seen[Number(seq&65535n)]===BigInt.asIntN(64,seq)||seq+65536n<=this.highestSequence)return this.reject();
  const nonce=Buffer.alloc(12);packet.copy(nonce,4,10,18);let body:Buffer;
  try{const decipher=createDecipheriv('aes-256-gcm',this.key,nonce);decipher.setAAD(packet.subarray(0,HEADER));decipher.setAuthTag(packet.subarray(-TAG));body=Buffer.concat([decipher.update(packet.subarray(HEADER,-TAG)),decipher.final()]);}catch{return this.reject();}
  // Do not move replay window on forged packets.
  this.highestSequence=seq>this.highestSequence?seq:this.highestSequence;this.seen[Number(seq&65535n)]=BigInt.asIntN(64,seq);

  this.stats.authenticatedPackets++;
  const id=BigInt(packet.readUInt32BE(18)),index=packet.readUInt16BE(22),count=packet.readUInt16BE(24),timestamp=BigInt(packet.readUIntBE(26,6)),key=packet[1]===1;
  if(!count||index>=count||id<=this.lastCompleted||count>this.budgetBytes)return this.reject();
  if(id>this.highestFrame){if(this.highestFrame>=0n&&id>this.highestFrame+1n)this.stats.droppedFrames+=Number(id-this.highestFrame-1n);this.highestFrame=id;}
  if(this.assembly&&id<this.assembly.id)return this.reject();
  if(this.assembly&&id>this.assembly.id){this.stats.droppedFrames++;this.awaitingKey=true;this.assembly=undefined;}
  if(!this.assembly){
   if(this.lastCompleted>=0n&&id>this.lastCompleted+1n)this.awaitingKey=true;
   if(this.awaitingKey&&!key)return;
   this.assembly={id,timestamp,key,count,bytes:0,first:now,parts:new Map()};
  }
  const a=this.assembly;
  if(a.count!==count||a.timestamp!==timestamp||a.key!==key||a.parts.has(index))return this.reject();
  if(a.bytes+body.length>this.budgetBytes){this.assembly=undefined;this.awaitingKey=true;this.stats.droppedFrames++;return this.reject();}
  a.parts.set(index,body);a.bytes+=body.length;
  if(a.parts.size!==a.count)return;
  const parts:Buffer[]=[];for(let i=0;i<a.count;i++)parts.push(a.parts.get(i)!);
  this.assembly=undefined;this.lastCompleted=id;this.awaitingKey=false;this.stats.completedFrames++;
  return {id,timestamp,key,data:Buffer.concat(parts,a.bytes)};
 }
 private reject(){this.stats.rejectedPackets++;return undefined;}
}
export function mediaSecrets(){return {session:randomBytes(8),sendKey:randomBytes(32),receiveKey:randomBytes(32)};}

export type DesktopFeedback={rttMs:number;jitterMs:number;loss:number;queueMs:number;decodeMs?:number;encodeMs?:number;processingMs?:number;deliveredBitsPerSecond:number};
export type DesktopQuality={fps:number;bitrate:number;scale:number};
/** Window percentile avoids one keyframe/IPC stall poisoning several later windows. */
export function desktopPercentile(values:readonly number[],fraction=.75){if(!values.length)return undefined;const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.floor((sorted.length-1)*fraction))];}
export class DesktopAdaptation {
 private clean=0;private networkBad=0;private computeBad=0;private lastChange=-Infinity;
 decision='hold';
 constructor(public current:DesktopQuality,readonly desired:DesktopQuality){
  for(const q of [current,desired])if(!Number.isFinite(q.fps)||!Number.isFinite(q.bitrate)||!Number.isFinite(q.scale)||q.fps<=0||q.bitrate<=0||q.scale<=0||q.scale>1)throw new Error('Invalid quality');
 }
 update(sample:DesktopFeedback,now=performance.now()):DesktopQuality{
  if(!Number.isFinite(now)||Object.values(sample).filter(v=>v!==undefined).some(v=>!Number.isFinite(v)||v<0)||sample.loss>1)throw new Error('Invalid telemetry');
  this.decision='hold';const interval=1000/this.current.fps;
  const network=sample.loss>.03||sample.queueMs>Math.max(50,sample.rttMs*.5)||sample.jitterMs>60;
  const severe=sample.loss>.15||sample.queueMs>Math.max(180,sample.rttMs);
  // Encoder and decoder are pipeline stages, not serialized work on one CPU.
  const compute=Math.max(sample.processingMs??sample.encodeMs??0,sample.decodeMs??0);
  const computeBound=compute>interval*1.2;
  this.networkBad=network?this.networkBad+1:0;this.computeBad=computeBound?this.computeBad+1:0;
  if(network||computeBound)this.clean=0;else this.clean++;
  const down=(severe||this.networkBad>=2||this.computeBad>=2)&&now-this.lastChange>=(severe?2000:4000);
  if(down){
   this.clean=0;this.lastChange=now;
   // Goodput measures content delivered, NOT available link capacity. A static
   // desktop may use almost no bytes even over a fast link; never clamp to it.
   const networkDown=severe||this.networkBad>=2,computeDown=this.computeBad>=2;
   const fps=computeDown?Math.min(this.current.fps*.9,1000/Math.max(1,compute)*.9):this.current.fps*(networkDown?.9:1);
   const scale=computeDown&&this.current.fps<this.desired.fps*.6?this.current.scale*.9:this.current.scale;
   this.current={bitrate:Math.max(1,this.current.bitrate*(networkDown?.75:1)),fps:Math.max(1,fps),scale:Math.max(1/16,scale)};
   this.decision=networkDown?'network-down':'compute-down';this.networkBad=0;this.computeBad=0;
  }else if(this.clean>=4&&now-this.lastChange>=8000){
   this.clean=0;const headroom=compute>0&&compute<interval*.75;
   const next={bitrate:Math.min(this.desired.bitrate,this.current.bitrate*1.12),fps:headroom?Math.min(this.desired.fps,this.current.fps*1.08):this.current.fps,scale:headroom?Math.min(this.desired.scale,this.current.scale*1.06):this.current.scale};
   if(next.bitrate!==this.current.bitrate||next.fps!==this.current.fps||next.scale!==this.current.scale){this.lastChange=now;this.current=next;this.decision='recover';}
  }
  return {...this.current};
 }
}
