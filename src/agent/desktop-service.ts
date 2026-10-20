import {desktopInputFailure} from './desktop-input-error';
import {createServer,type Server,type Socket,isIP} from 'node:net';
import {randomBytes,createHmac,timingSafeEqual} from 'node:crypto';
import {DesktopSession} from './desktop-session';
import {NativeDesktop,type NativeDesktopFrame,type NativeDesktopInput} from './desktop-native';
import {DesktopAdaptation,desktopPercentile,type DesktopFeedback} from './desktop-media';
import {desktopConfigSchema,desktopQualitySchema,type DesktopConfig,type DesktopTicket,type DesktopOpenRequest,type DesktopQuality,type DesktopVideoInfo} from '../shared/agent-desktop';

export function desktopProof(key:string,text:string){return createHmac('sha256',Buffer.from(key,'hex')).update(text).digest('hex');}
export function verifyDesktopProof(expected:string,value:unknown){return typeof value==='string'&&/^[0-9a-f]{64}$/.test(value)&&timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(value,'hex'));}
/** Bounded bootstrap parser. Pause at the record boundary so encrypted bytes
 * arriving in the same TCP callback are restored before DesktopSession starts. */
export function desktopLine(socket:Socket):Promise<string>{return new Promise((resolve,reject)=>{
 let bytes=Buffer.alloc(0);const timer=setTimeout(()=>done(new Error('DESKTOP_BOOTSTRAP_TIMEOUT')),5000);
 const done=(error?:Error,line?:string)=>{clearTimeout(timer);socket.off('data',data);socket.off('error',fail);socket.off('close',closed);error?reject(error):resolve(line!);};
 const fail=(error:Error)=>done(error);const closed=()=>done(new Error('DESKTOP_BOOTSTRAP_CLOSED'));
 const data=(chunk:Buffer)=>{bytes=Buffer.concat([bytes,chunk]);const end=bytes.indexOf(10);if(end<0){if(bytes.length>4096)done(new Error('DESKTOP_BOOTSTRAP_LENGTH'));return;}if(end>4096){done(new Error('DESKTOP_BOOTSTRAP_LENGTH'));return;}socket.pause();const rest=bytes.subarray(end+1);if(rest.length)socket.unshift(rest);done(undefined,bytes.subarray(0,end).toString());};
 socket.on('data',data);socket.once('error',fail);socket.once('close',closed);socket.resume();
 });}
type Active={id:string;owner:string;session:DesktopSession;capture?:NativeDesktop;quality:DesktopQuality;nextId:bigint;lastAck:number;acked:bigint;awaiting?:bigint;restarting:boolean;nativeReady:boolean;recoveryCount?:number;recoveryTimer?:ReturnType<typeof setTimeout>;unavailableSince?:number;unavailableAttempts?:number;recoveringDesktop?:boolean;forceGdi?:boolean;nativeGeneration:number;nativeSequence:number;control:boolean;info?:DesktopVideoInfo;adaptation?:DesktopAdaptation;encodeMs?:number;encodeSamples:number[];processingSamples:number[];flight?:Promise<boolean>;stopping?:Promise<void>;frameTimer?:ReturnType<typeof setTimeout>;captureTimer?:ReturnType<typeof setTimeout>;qualityTimer?:ReturnType<typeof setTimeout>;queuedQuality?:{quality:DesktopQuality;retain:boolean}};
export class DesktopService {
 private config:DesktopConfig=desktopConfigSchema.parse({});private server?:Server;private pending=new Map<string,{ticket:DesktopTicket;quality:DesktopQuality}>();
 private lastFailure?:{stage:string;code:string;message:string;at:string};private failureOwner?:string;
 private failure(owner:string,stage:string,code:string,error?:string){if(stage==='input'){const input=desktopInputFailure(error??'');this.failureOwner=owner;this.lastFailure={stage,code:input.code,message:input.message,at:new Date().toISOString()};return;}const win32=error?.match(/GDI BitBlt failed: (\d+)/)?.[1];const hr=error?.match(/HRESULT\s+(0x[0-9a-f]{8})/i)?.[1];const detail=error?.match(/^(desktop duplication|capture frame|capture map|D3D11 device|hardware encoder input timeout|hardware encoder output timeout|display not found|capture settings exceed source or memory budget|GDI BitBlt failed|CAPTURE_DESKTOP_UNAVAILABLE|CAPTURE_SECURE_OR_INACCESSIBLE_DESKTOP|CAPTURE_SECURE_OR_DIFFERENT_DESKTOP|output pipe closed)(?::|$)/)?.[1];this.failureOwner=owner;this.lastFailure={stage,code,message:[detail??'Native desktop operation failed',hr,win32?'Win32 '+win32:undefined].filter(Boolean).join(': '),at:new Date().toISOString()};}
 private sockets=new Set<Socket>();private active?:Active;private changing=false;
 constructor(private options:{identity:string;nativeExecutable:string|(()=>string);authorize:(owner:string,permission:'view'|'control')=>boolean;persist?:(config:DesktopConfig)=>Promise<void>;captureFactory?:()=>NativeDesktop;diagnostic?:(event:{stage:string;message:string})=>void}){}
 private allowed(owner:string,permission:'view'|'control'){
  const grant=owner==='local'?this.config.local:(this.config.ownerGrants[owner]??(this.config.authenticatedPeers?{view:true,control:true}:undefined));
  try{return this.config.enabled&&!!grant?.view&&!!grant[permission]&&this.options.authorize(owner,permission);}catch{return false;}
 }
 status(owner:string){return {lastFailure:owner==='local'||owner===this.failureOwner?this.lastFailure:undefined,enabled:this.config.enabled,listening:!!this.server&&this.config.directListener,config:this.config,viewAllowed:this.allowed(owner,'view'),controlAllowed:this.allowed(owner,'control'),active:this.active?.owner===owner?{id:this.active.id,quality:this.active.quality,control:this.active.control&&this.active.nativeReady,video:this.active.info}:undefined,busy:!!this.active,qualityModes:['bounded','unlimited'],implementation:'native-dxgi-mf',relay:false};}
 async configure(value:unknown){
  if(this.changing)throw new Error('DESKTOP_CONFIGURATION_BUSY');const config=desktopConfigSchema.parse(value);if(!isIP(config.bindAddress))throw new Error('DESKTOP_BIND_ADDRESS_MUST_BE_IP');
  this.changing=true;try{await this.shutdown();this.config={...config,enabled:false};
   if(config.enabled){const server=createServer(socket=>{void this.accept(socket);});this.server=server;server.maxConnections=8;server.on('error',()=>{void this.shutdown();});await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(config.directListener?config.tcpPort:0,config.directListener?config.bindAddress:'127.0.0.1',()=>{server.off('error',reject);resolve();});});}
   this.config=config;await this.options.persist?.(config);return this.status('local');
  }catch(error){await this.shutdown();this.config.enabled=false;throw error;}finally{this.changing=false;}
 }
 open(owner:string,request:DesktopOpenRequest):DesktopTicket{
  if(this.changing||!this.config.enabled||(request.transport!=='management'&&!this.server)||!this.allowed(owner,'view'))throw new Error('DESKTOP_VIEW_DENIED');
  const quality=desktopQualitySchema.parse(request.quality);if(request.control&&!this.allowed(owner,'control'))throw new Error('DESKTOP_CONTROL_DENIED');
  for(const [id,p] of this.pending)if(p.ticket.expiresAt<=Date.now())this.pending.delete(id);
  if(this.active||this.pending.size)throw new Error('DESKTOP_SINGLE_SESSION_BUSY');
  const ticket:DesktopTicket={id:randomBytes(16).toString('hex'),expiresAt:Date.now()+30000,hostIdentity:this.options.identity,owner,generation:randomBytes(16).toString('hex'),session:randomBytes(8).toString('hex'),control:!!request.control,mediaTransport:request.mediaTransport,transport:request.transport??'direct',localTcpPort:typeof this.server?.address()==='object'?(this.server!.address() as {port:number}).port:this.config.tcpPort,localUdpPort:!this.config.directListener?0:this.config.udpPort,tcpPort:this.config.publicTcpPort??this.config.tcpPort,udpPort:this.config.publicUdpPort??this.config.udpPort,keys:{hostControl:randomBytes(32).toString('hex'),viewerControl:randomBytes(32).toString('hex'),hostMedia:randomBytes(32).toString('hex'),viewerMedia:randomBytes(32).toString('hex'),bootstrap:randomBytes(32).toString('hex')}};
  this.pending.set(ticket.id,{ticket,quality});return structuredClone(ticket);
 }
 async close(owner:string,id:string){const pending=this.pending.get(id);if(pending){if(pending.ticket.owner!==owner)throw new Error('DESKTOP_SESSION_NOT_FOUND');this.pending.delete(id);return;}
  if(!this.active||this.active.id!==id||this.active.owner!==owner)throw new Error('DESKTOP_SESSION_NOT_FOUND');await this.active.session.close('OWNER_CLOSED');}
 async revoke(owner:string){for(const [id,p] of this.pending)if(p.ticket.owner===owner)this.pending.delete(id);if(this.active?.owner===owner)await this.active.session.close('OWNER_REVOKED');}
 async shutdown(){this.pending.clear();for(const socket of this.sockets)socket.destroy();if(this.active)await this.active.session.close('SERVICE_STOPPED');const server=this.server;this.server=undefined;if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));}
 /** Only invoked after pinned Agent TLS authentication and management authorization. */
 async acceptAuthenticated(socket:Socket,owner:string){if(!this.allowed(owner,'view')){socket.destroy();return;}return this.accept(socket,owner);}
 private async accept(socket:Socket,authenticatedOwner?:string){
  if(this.sockets.size>=8){socket.destroy();return;}this.sockets.add(socket);socket.once('close',()=>this.sockets.delete(socket));socket.on('error',()=>{});
  try{
   const nonce=randomBytes(32).toString('hex');socket.write(JSON.stringify({version:1,nonce})+'\n');const response=JSON.parse(await desktopLine(socket));
   const item=this.pending.get(response.id);if(!item||item.ticket.expiresAt<=Date.now()||this.active)throw new Error('Invalid ticket');const {ticket,quality}=item;
   if((authenticatedOwner!==undefined?(ticket.owner!==authenticatedOwner||ticket.transport!=='management'):ticket.transport==='management')||!this.allowed(ticket.owner,'view')||(ticket.control&&!this.allowed(ticket.owner,'control'))||!verifyDesktopProof(desktopProof(ticket.keys.bootstrap,`client:${nonce}:${ticket.id}`),response.proof))throw new Error('Ticket rejected');
   this.pending.delete(ticket.id);const peer=socket.remoteAddress?.replace(/^::ffff:/,'');if(!peer||!isIP(peer))throw new Error('Peer address unavailable');
   socket.write(JSON.stringify({proof:desktopProof(ticket.keys.bootstrap,`server:${nonce}:${ticket.id}`)})+'\n');
   const session=new DesktopSession({transport:authenticatedOwner===undefined?'udp':(ticket.mediaTransport??'tcp'),control:socket,binding:{localIdentity:ticket.hostIdentity,peerIdentity:ticket.owner,generation:ticket.generation,session:Buffer.from(ticket.session,'hex'),sendControlKey:Buffer.from(ticket.keys.hostControl,'hex'),receiveControlKey:Buffer.from(ticket.keys.viewerControl,'hex'),sendMediaKey:Buffer.from(ticket.keys.hostMedia,'hex'),receiveMediaKey:Buffer.from(ticket.keys.viewerMedia,'hex'),peerAddress:peer},bindAddress:ticket.owner==='local'&&!this.config.directListener?'127.0.0.1':this.config.bindAddress,bindPort:ticket.owner==='local'&&!this.config.directListener?0:this.config.udpPort,advertisedPort:ticket.owner==='local'&&!this.config.directListener?undefined:ticket.udpPort,authorized:()=>{if(active.control&&!this.allowed(ticket.owner,'control')){active.control=false;try{active.capture?.revokeInput();}catch{}}return this.allowed(ticket.owner,'view');},release:async()=>{clearTimeout(active.captureTimer);clearTimeout(active.qualityTimer);clearTimeout(active.recoveryTimer);clearTimeout(active.frameTimer);await active.stopping;await active.capture?.stop();if(this.active===active)this.active=undefined;}});
   const active:Active={id:ticket.id,owner:ticket.owner,session,quality,nextId:0n,lastAck:performance.now(),acked:-1n,restarting:false,nativeReady:false,nativeGeneration:0,nativeSequence:0,control:ticket.control,encodeSamples:[],processingSamples:[]};this.active=active;session.on('closed',(reason:string)=>this.options.diagnostic?.({stage:'session.closed',message:reason}));
   session.on('ready',()=>{void this.capture(active,quality).catch(error=>{this.failure(active.owner,'capture.start','CAPTURE_START_FAILED',String(error));void session.close('CAPTURE_START_FAILED');});});
   session.on('ack',(id:string)=>{const acknowledged=BigInt(id);if(acknowledged<active.nextId&&acknowledged>active.acked){active.acked=acknowledged;active.lastAck=performance.now();}if(active.awaiting!==undefined&&String(active.awaiting)===id){active.awaiting=undefined;clearTimeout(active.frameTimer);void Promise.resolve(active.flight).then(()=>{if(this.active!==active)return;const queued=active.queuedQuality;active.queuedQuality=undefined;if(queued)void this.capture(active,queued.quality,queued.retain).catch(()=>void session.close('QUALITY_RECONFIGURE_FAILED'));});}});
   session.on('keyframe',()=>{if(active.nativeReady)active.capture?.requestKeyframe();});
   session.on('quality',(value:unknown)=>{try{const q=desktopQualitySchema.parse(value);active.adaptation=undefined;void this.capture(active,q).catch(()=>void session.close('QUALITY_RECONFIGURE_FAILED'));}catch{session.notice('Invalid quality settings');}});
   session.on('input',(event:NativeDesktopInput)=>{if(!active.nativeReady||!active.control)return;if(!active.control||!this.allowed(active.owner,'control')){try{active.capture?.revokeInput();}catch{}active.control=false;session.notice('Control permission denied');return;}try{active.capture?.input({...event,generation:active.nativeGeneration,sequence:++active.nativeSequence});}catch{session.notice('Invalid input event');}});
   session.on('release-input',()=>{if(!active.nativeReady)return;try{active.capture?.revokeInput();if(active.control&&this.allowed(active.owner,'control')){active.capture?.grantInput(++active.nativeGeneration);active.nativeSequence=0;}}catch{void session.close('INPUT_RELEASE_FAILED');}});
   session.on('feedback',(value:DesktopFeedback)=>{
    if(!active.quality.adaptive||!active.info||active.restarting||active.queuedQuality)return;
    try{const adapter=active.adaptation;if(!adapter)return;const current={...adapter.current};
     const sample={...value,encodeMs:desktopPercentile(active.encodeSamples),processingMs:desktopPercentile(active.processingSamples)};
     active.encodeSamples=[];active.processingSamples=[];
     const changed=adapter.update(sample);
     this.options.diagnostic?.({stage:'adaptation',message:JSON.stringify({before:current,after:changed,decision:adapter.decision,sample})});
     if(Math.abs(changed.bitrate-current.bitrate)>1||Math.abs(changed.fps-current.fps)>.1||Math.abs(changed.scale-current.scale)>.0001){
      void this.capture(active,{...active.quality,fps:Math.max(1,Math.round(changed.fps)),bitrate:Math.max(1,Math.round(changed.bitrate)),width:Math.max(2,Math.floor(active.info.sourceWidth*changed.scale/2)*2),height:Math.max(2,Math.floor(active.info.sourceHeight*changed.scale/2)*2)},true).catch(()=>void session.close('ADAPTATION_FAILED'));
     }
    }catch{session.notice('Invalid feedback');}
   });
   socket.resume();await session.start();
  }catch{socket.destroy();}
 }
 private waitForDesktop(active:Active,error:string){
  clearTimeout(active.captureTimer);active.nativeReady=false;active.awaiting=undefined;active.queuedQuality=undefined;clearTimeout(active.frameTimer);
  active.unavailableSince??=performance.now();active.unavailableAttempts=(active.unavailableAttempts??0)+1;active.recoveringDesktop=true;
  this.failure(active.owner,'capture.wait','CAPTURE_ACCESS_DENIED',error);
  if(performance.now()-active.unavailableSince>=120000){void active.session.close('CAPTURE_ACCESS_DENIED');return;}
  if(active.unavailableAttempts===1)active.session.notice('INPUT_SUSPENDED: Windows 桌面暂不可采集，正在等待会话恢复；恢复期间停止键鼠控制。');
  // Recreate capture resources after session/display changes. Never transfer,
  // unlock or reconnect a Windows session. Keep the authenticated media channel.
  active.forceGdi=false;
  active.recoveryTimer=setTimeout(()=>{active.recoveryTimer=undefined;if(this.active!==active||!active.session.ready)return;if(!this.allowed(active.owner,'view')){void active.session.close('OWNER_REVOKED');return;}void this.capture(active,active.quality).catch(()=>void active.session.close('CAPTURE_RECOVERY_FAILED'));},Math.min(5000,500*2**Math.min(active.unavailableAttempts-1,4)));
  active.recoveryTimer.unref();
 }
 private requestFrame(active:Active,capture:NativeDesktop){
  capture.requestFrame();clearTimeout(active.captureTimer);const nextId=active.nextId;
  // Track native progress separately from network acknowledgements. DXGI can
  // remain alive but stop producing updates after a virtual desktop transition.
  active.captureTimer=setTimeout(()=>{
   if(this.active!==active||active.capture!==capture||!active.session.ready||active.nextId!==nextId||active.restarting||active.queuedQuality)return;
   if(!active.forceGdi){
    active.forceGdi=true;active.session.notice(nextId===0n?'桌面采集未输出首帧，正在切换兼容采集…':'桌面采集暂未更新，正在切换兼容采集…');
    void this.capture(active,active.quality,true).catch(()=>void active.session.close('CAPTURE_RECOVERY_FAILED'));
   }else{this.failure(active.owner,'capture.progress','CAPTURE_NO_FRAMES','Capture produced no frame');void active.session.close('CAPTURE_NO_FRAMES');}
  },3000);active.captureTimer.unref();
 }
 private async capture(active:Active,quality:DesktopQuality,retainAdaptation=false){
  if(this.active!==active)return;if(active.recoveryTimer){active.quality=quality;return;}if(active.restarting){active.queuedQuality={quality,retain:retainAdaptation};return;}if(active.awaiting!==undefined){
   active.queuedQuality={quality,retain:retainAdaptation};
   // Bound the transition independently of frame arrival/ack timers. A dropped
   // final frame must not leave native capture paused indefinitely.
   if(!active.qualityTimer){active.qualityTimer=setTimeout(()=>{
    active.qualityTimer=undefined;
    void Promise.resolve(active.flight).then(()=>{
     if(this.active!==active||!active.session.ready||!this.allowed(active.owner,'view')||!active.queuedQuality||active.restarting)return;
     const queued=active.queuedQuality;active.queuedQuality=undefined;active.awaiting=undefined;
     void this.capture(active,queued.quality,queued.retain).catch(()=>void active.session.close('QUALITY_RECONFIGURE_FAILED'));
    });
   },1500);active.qualityTimer.unref();}
   return;
  }clearTimeout(active.qualityTimer);active.qualityTimer=undefined;active.restarting=true;
  try{const previous=active.capture;active.capture=undefined;active.nativeReady=false;clearTimeout(active.captureTimer);clearTimeout(active.frameTimer);active.stopping=previous?.stop();await active.flight;await active.stopping;if(this.active!==active)return;active.awaiting=undefined;active.encodeSamples=[];active.processingSamples=[];active.quality=quality;if(!retainAdaptation)active.adaptation=undefined;
   const capture=this.options.captureFactory?.()??new NativeDesktop(typeof this.options.nativeExecutable==='function'?this.options.nativeExecutable():this.options.nativeExecutable);active.capture=capture;
   capture.on('ready',(info:DesktopVideoInfo)=>{if(this.active!==active||active.capture!==capture)return;active.nativeReady=true;active.info={...info,unlimitedQuality:true,codec:'avc1.4d001e'};if(!active.adaptation){const q={fps:quality.fps,bitrate:quality.bitrate,scale:info.width/info.sourceWidth};active.adaptation=new DesktopAdaptation({...q},{...q},!!quality.unlimited);}active.session.video(active.info);if(active.control&&this.allowed(active.owner,'control')){capture.grantInput(++active.nativeGeneration);active.nativeSequence=0;}this.requestFrame(active,capture);});
   capture.on('frame',(frame:NativeDesktopFrame)=>{if(this.active!==active||active.capture!==capture||active.restarting||!active.nativeReady)return;clearTimeout(active.captureTimer);if(active.recoveringDesktop){active.recoveringDesktop=false;active.unavailableSince=undefined;active.unavailableAttempts=0;this.lastFailure=undefined;active.session.notice(active.control&&this.allowed(active.owner,'control')?'INPUT_RESUMED':'INPUT_DISABLED: 远端未授予键鼠控制权限');}active.encodeMs=Number.isFinite(frame.encodeUs)?frame.encodeUs/1000:undefined;if(active.encodeMs!==undefined){active.encodeSamples.push(active.encodeMs);if(active.encodeSamples.length>128)active.encodeSamples.shift();}if([frame.captureUs,frame.convertUs,frame.encodeUs].every(v=>Number.isFinite(v)&&v>=0)){active.processingSamples.push((frame.captureUs+frame.convertUs+frame.encodeUs)/1000);if(active.processingSamples.length>128)active.processingSamples.shift();}const id=active.nextId++;active.awaiting=id;active.flight=active.session.sendFrame({id,timestamp:BigInt(frame.timestampUs),key:frame.key,data:frame.data});void active.flight.then(sent=>{if(this.active!==active||active.capture!==capture)return;if(!sent){void active.session.close('FRAME_SEND_FAILED');return;}if(!active.queuedQuality){if(performance.now()-active.lastAck>1000)capture.requestKeyframe();this.requestFrame(active,capture);}});clearTimeout(active.frameTimer);active.frameTimer=setTimeout(()=>{if(this.active===active&&active.capture===capture&&active.awaiting===id)void Promise.resolve(active.flight).then(()=>{if(this.active===active&&active.capture===capture&&active.awaiting===id){capture.requestKeyframe();}});},1000);active.frameTimer.unref();});
   capture.on('closed',(event:{code:number;error:string})=>{this.options.diagnostic?.({stage:'native.closed',message:JSON.stringify({code:event.code})});if(this.active===active&&active.capture===capture&&!active.restarting&&active.session.ready){this.failure(active.owner,'capture.exit','CAPTURE_CLOSED',event.error);if(/GDI BitBlt failed: 5\b|CAPTURE_(SECURE|DESKTOP_UNAVAILABLE)|HRESULT 0x887a0026|HRESULT 0x887a0005|HRESULT 0x887a0006|HRESULT 0x887a0022|display not found|GDI display has no area/i.test(event.error)){this.waitForDesktop(active,event.error);}else if((active.recoveryCount??0)<2&&this.allowed(active.owner,'view')){active.recoveryCount=(active.recoveryCount??0)+1;if(/capture frame: HRESULT 0x887a0001/i.test(event.error))active.forceGdi=true;active.nativeReady=false;active.awaiting=undefined;active.queuedQuality=undefined;active.recoveringDesktop=true;active.session.notice('INPUT_SUSPENDED: 远端采集退出，正在恢复画面。');void this.capture(active,active.quality).catch(()=>void active.session.close('CAPTURE_RECOVERY_FAILED'));}else{void active.session.close('CAPTURE_CLOSED');}}});
   capture.on('fault',(error:Error)=>{if(this.active!==active||active.capture!==capture||!active.session.ready)return;this.failure(active.owner,'capture.fault','CAPTURE_FAILED',error.message);this.options.diagnostic?.({stage:'native.fault',message:this.lastFailure!.message});void active.session.close('CAPTURE_FAILED');});capture.on('input-error',(error:Error)=>{if(this.active!==active||active.capture!==capture||!active.control)return;active.control=false;try{capture.revokeInput();}catch{}const detail=desktopInputFailure(error.message);const reason=detail.message+'（'+detail.code+'）';this.failure(active.owner,'input','INPUT_FAILED',error.message);active.session.notice('INPUT_DISABLED: '+reason+'；当前保留画面。');});
   capture.start({display:quality.display,width:quality.width,height:quality.height,fps:quality.fps,bitrate:quality.bitrate,...(active.forceGdi?{forceGdi:1}:{})});
  }finally{active.stopping=undefined;active.restarting=false;const queued=active.queuedQuality;if(queued&&active.awaiting===undefined&&this.active===active){active.queuedQuality=undefined;void this.capture(active,queued.quality,queued.retain).catch(()=>void active.session.close('QUALITY_RECONFIGURE_FAILED'));}}
 }
}












