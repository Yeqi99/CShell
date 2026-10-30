import {EventEmitter} from 'node:events';
import type {DesktopClient,DesktopClientInput} from './desktop-client';
import type {DesktopQuality} from '../shared/agent-desktop';
import type {MediaFrame} from '../agent/desktop-media';

/** One authenticated transport, independent renderer credit. The first renderer
 * that consumes a frame releases transport credit; a hidden preview cannot hold
 * a foreground window hostage. Each DesktopViews entry still drops its own
 * predictive frames until it receives a keyframe. */
export class SharedDesktop {
 private subscribers=new Set<EventEmitter>();
 private acked=-1n;private frame=-1n;private reported=-1n;private keyAt=-Infinity;
 private ended=false;private stopping?:Promise<void>;
 constructor(readonly client:DesktopClient,private closeHost:()=>Promise<unknown>,private removed:()=>void){
  for(const event of ['video','notice','frame','closed'])client.on(event,(value:unknown)=>{
   if(event==='closed'){this.ended=true;removed();}
   if(event==='frame')this.frame=(value as MediaFrame).id;
   for(const subscriber of this.subscribers)subscriber.emit(event,value);
  });
 }
 acquire(){
  if(this.ended)throw new Error('Desktop connection closed');
  const subscriber=new EventEmitter();this.subscribers.add(subscriber);let released=false;
  const lease=Object.assign(subscriber,{
   get videoInfo(){return undefined;},
   input:(value:DesktopClientInput)=>this.client.input(value),
   inputConfirmed:(value:DesktopClientInput)=>this.client.inputConfirmed(value),
   releaseInput:()=>this.client.releaseInput(),
   quality:(value:DesktopQuality)=>this.client.quality(value),
   ack:(value:string|bigint)=>{const id=BigInt(value);if(id>this.acked){this.acked=id;return this.client.ack(id);}},
   reportDecode:(ms:number,queue:number)=>{if(this.reported!==this.frame){this.reported=this.frame;this.client.reportDecode(ms,queue);}},
   requestKeyframe:()=>{const now=performance.now();if(now-this.keyAt>=500){this.keyAt=now;return this.client.requestKeyframe();}},
   close:async()=>{if(released)return;released=true;this.subscribers.delete(subscriber);subscriber.removeAllListeners();if(!this.subscribers.size){this.ended=true;this.removed();this.stopping??=(async()=>{try{await this.client.close();}finally{await this.closeHost().catch(()=>{});}})();await this.stopping;}},
  });
  Object.defineProperty(lease,'videoInfo',{get:()=>this.client.videoInfo});
  return lease as unknown as DesktopClient;
 }
}
