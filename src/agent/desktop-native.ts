import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
export type NativeDesktopConfig={display?:number;width?:number;height?:number;fps:number;bitrate:number;memoryBudgetBytes?:number;forceGdi?:number};
export type NativeDesktopFrame={type:'frame';id:number;key:boolean;timestampUs:number;captureUs:number;convertUs:number;encodeUs:number;data:Buffer};
export type NativeDesktopInput={generation:number;sequence:number}&(
 {kind:'lease'}|{kind:'text';text:string}|{kind:'key';code:number;down:boolean}|{kind:'button';button:number;down:boolean}|
 {kind:'move';x:number;y:number}|{kind:'wheel';delta:number;horizontal?:boolean});
export class NativeDesktop extends EventEmitter {
 private child?:ChildProcessWithoutNullStreams;private pending=Buffer.alloc(0);private errorText='';private finished=false;private stopping=false;
 constructor(private executable:string,private maxFrameBytes=32*1024*1024){super();}
 start(config:NativeDesktopConfig){
  if(this.child)throw new Error('Capture already started');
  for(const [name,value] of Object.entries(config))if(value!==undefined&&(!Number.isSafeInteger(value)||value<(name==='display'?0:1)||value>0xffffffff))throw new Error(`Invalid native setting: ${name}`);
  if(!config.fps||!config.bitrate)throw new Error('Frame rate and bitrate required');
  const child=this.child=spawn(this.executable,['--stream'],{windowsHide:true,stdio:'pipe'});
  child.stdout.on('data',(data:Buffer)=>{try{this.read(data);}catch(error){this.emit('fault',error);void this.stop();}});
  child.stderr.on('data',(data:Buffer)=>{this.errorText=(this.errorText+data.toString()).slice(-4096);});
  child.on('error',error=>this.emit('fault',error));
  child.on('close',code=>{this.finished=true;this.pending=Buffer.alloc(0);this.emit('closed',{code,error:this.errorText});});
  child.stdin.on('error',error=>{if(!this.finished&&!this.stopping)this.emit('fault',error);});
  this.send({op:'configure',...config});
 }
 private read(data:Buffer){
  if(this.pending.length+data.length>this.maxFrameBytes+8192+8)throw new Error('Native media budget exceeded');
  this.pending=Buffer.concat([this.pending,data]);
  while(this.pending.length>=8){
   const header=this.pending.readUInt32LE(0),body=this.pending.readUInt32LE(4);
   if(header>8192||body>this.maxFrameBytes)throw new Error('Invalid native packet length');
   const total=8+header+body;if(this.pending.length<total)return;
   const meta=JSON.parse(this.pending.subarray(8,8+header).toString('utf8'));
   const payload=Buffer.from(this.pending.subarray(8+header,total));this.pending=this.pending.subarray(total);
   if(meta.type==='ready')this.emit('ready',meta);
   else if(meta.type==='frame'){
    if(!Number.isSafeInteger(meta.id)||meta.id<0||typeof meta.key!=='boolean'||!Number.isSafeInteger(meta.timestampUs)||!payload.length)throw new Error('Invalid native frame');
    this.emit('frame',{...meta,data:payload} satisfies NativeDesktopFrame);
   }else if(meta.type==='input-status')this.emit('input-status',meta);
   else if(meta.type==='input-error')this.emit('input-error',new Error(String(meta.message).slice(0,1024)));
   else throw new Error('Unknown native packet');
  }
 }
 private send(command:unknown){if(!this.child||this.finished||this.child.stdin.writableEnded||this.child.stdin.destroyed)throw new Error('Capture is closed');if(this.child.stdin.writableLength>8192)throw new Error('Native control backpressure');this.child.stdin.write(JSON.stringify(command)+'\n');}
 requestFrame(){if(this.stopping||this.finished)return;this.send({op:'ack'});}
 requestKeyframe(){if(this.stopping||this.finished)return;this.send({op:'keyframe'});}
 /** Backend-only: call after separately authorizing control on the authenticated
  * desktop session. Watching permission must never call this method. A fresh
  * increasing generation is required; reconnect must not replay old input.
  * Stop renewing the lease immediately on revoke/transport loss and call
  * revokeInput(); the helper independently releases after 5 seconds or EOF. */
 grantInput(generation:number){
  if(!Number.isSafeInteger(generation)||generation<1)throw new Error('Invalid input generation');
  this.send({op:'input-grant',generation});
 }
 revokeInput(){this.send({op:'input-revoke'});}
 input(event:NativeDesktopInput){
  if(!Number.isSafeInteger(event.generation)||event.generation<1||!Number.isSafeInteger(event.sequence)||event.sequence<1)throw new Error('Invalid input ordering');
  if(event.kind==='key'&&(!Number.isInteger(event.code)||event.code<1||event.code>0x1ff||!(event.code&0xff)||typeof event.down!=='boolean'))throw new Error('Invalid scan code');
  if(event.kind==='button'&&(!Number.isInteger(event.button)||event.button<0||event.button>4||typeof event.down!=='boolean'))throw new Error('Invalid mouse button');
  if(event.kind==='move'&&[event.x,event.y].some(n=>!Number.isFinite(n)||n<0||n>1))throw new Error('Invalid pointer position');
  if(event.kind==='wheel'&&(!Number.isInteger(event.delta)||event.delta< -32768||event.delta>32767||(event.horizontal!==undefined&&typeof event.horizontal!=='boolean')))throw new Error('Invalid wheel event');
  if(event.kind==='text'&&(typeof event.text!=='string'||!event.text.length||event.text.length>512||event.text.includes('\0')))throw new Error('Invalid text input');
  if(!['key','button','move','wheel','lease','text'].includes(event.kind))throw new Error('Unsupported input kind');
  this.send({op:'input-event',event});
 }
 async stop(){
  const child=this.child;if(!child||this.finished)return;this.stopping=true;
  try{this.send({op:'stop'});child.stdin.end();}catch{/* Already disconnected. */}
  await new Promise<void>(resolve=>{
   const timeout=setTimeout(()=>{child.kill();},2500);
   const deadline=setTimeout(resolve,4000);
   child.once('close',()=>{clearTimeout(timeout);clearTimeout(deadline);resolve();});
  });
 }
}

