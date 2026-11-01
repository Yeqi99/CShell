import {createServer,type Server,type Socket} from 'node:net';
import {request} from 'node:http';
import {tunnelFetch} from '../core/tunnel-fetch';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
/** A controller-owned loopback proxy ingress. Requests are carried over authenticated RPC, never LAN. */
export class AgentNetworkProxy{
 private pending:Promise<unknown>=Promise.resolve();
 private serial<T>(fn:()=>Promise<T>){const next=this.pending.catch(()=>{}).then(fn);this.pending=next;return next;}
 private disposed=false;
 private selected=false;
 private selectionOwner?:string;
 private selectionBinding?:string;
 private generation=0;
 get configured(){return this.selected;}
 async load(selected:boolean,owner?:string,binding?:string){this.selected=selected;this.selectionOwner=owner;this.selectionBinding=binding;}
 private lease?:{owner:string;id:string;server:Server;port:number;until:number};
 private channels=new Map<string,{socket:Socket;data:Buffer;ended:boolean;announced:boolean}>();
 private timer=setInterval(()=>{const expired=this.lease;if(expired&&(expired.until<Date.now()||!this.allowed(expired.owner)))void this.serial(async()=>{if(this.lease===expired&&(expired.until<Date.now()||!this.allowed(expired.owner)))await this.closeNow();});},1000);
 constructor(private allowed:(owner:string)=>boolean,private persist:(selected:boolean,owner?:string,binding?:string)=>Promise<void>=async()=>{}){this.timer.unref();}
 get activity(){return this.channels.size;}
 environment():Record<string,string>{if(!this.selected)return {};if(!this.lease||this.lease.until<Date.now()||!this.allowed(this.lease.owner))throw Error('所选网络出口不可用，未回退直连');const url='http://127.0.0.1:'+this.lease.port;return {HTTP_PROXY:url,HTTPS_PROXY:url,http_proxy:url,https_proxy:url,ALL_PROXY:url,all_proxy:url,NO_PROXY:'',no_proxy:''};}
 private guard(owner:string,id?:string){if(this.disposed||!this.allowed(owner))throw Error('网络代理未授权');if(id&&(!this.lease||this.lease.id!==id||this.lease.owner!==owner||this.lease.until<Date.now()))throw Error('网络代理会话已失效');}
 async call(method:string,raw:unknown,owner:string):Promise<unknown>{if(method==='network.proxy.start'||method==='network.proxy.stop'||method==='network.proxy.clear')return this.serial(()=>this.callNow(method,raw,owner));return this.callNow(method,raw,owner);}
 private async callNow(method:string,raw:unknown,owner:string){this.guard(owner);
  if(method==='network.proxy.clear'){const {binding}=z.object({binding:z.string().uuid()}).strict().parse(raw);if(this.selectionBinding!==binding)return {cleared:false,superseded:true};if(this.selectionOwner&&this.selectionOwner!==owner&&owner!=='local')throw Error('网络代理属于另一控制端');await this.persist(false);this.selected=false;this.selectionOwner=undefined;this.selectionBinding=undefined;await this.closeNow();return{cleared:true};}
  if(method==='network.proxy.start'){
   const {binding}=z.object({binding:z.string().uuid().optional()}).strict().parse(raw??{});if(this.lease&&this.lease.owner!==owner)throw Error('已有控制端管理此网络出口');if(this.selectionOwner&&this.selectionOwner!==owner&&owner!=='local')throw Error('网络代理属于另一控制端');const selectionBinding=binding??randomUUID();await this.persist(true,owner,selectionBinding);this.guard(owner);this.selected=true;this.selectionOwner=owner;this.selectionBinding=selectionBinding;if(this.lease){if(this.lease.owner!==owner)throw Error('已有控制端管理此网络出口');await this.closeNow();}
   const server=createServer({allowHalfOpen:true},socket=>{if(this.channels.size>=64||!this.lease){socket.destroy();return;}const id=randomUUID(),c={socket,data:Buffer.alloc(0),ended:false,announced:false};this.channels.set(id,c);socket.on('data',b=>{c.data=Buffer.concat([c.data,Buffer.from(b)]);if(c.data.length>524288){socket.destroy();this.channels.delete(id);return;}if(c.data.length>=262144)socket.pause();});socket.on('end',()=>{c.ended=true});socket.on('close',()=>{c.ended=true;});socket.on('error',()=>{c.ended=true});});
   await new Promise<void>((ok,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',ok)});const address=server.address();if(!address||typeof address==='string')throw Error('代理监听失败');this.lease={owner,id:randomUUID(),server,port:address.port,until:Date.now()+15000};return{id:this.lease.id,port:address.port};
  }
  const p=z.object({id:z.string().uuid(),channel:z.string().uuid().optional(),data:z.string().max(87384).optional()}).strict().parse(raw);this.guard(owner,p.id);this.lease!.until=Date.now()+15000;
  if(method==='network.proxy.stop'||method==='network.proxy.clear'){await this.persist(false);this.selected=false;this.selectionOwner=undefined;this.selectionBinding=undefined;await this.closeNow();return{closed:true};}
  if(method==='network.proxy.poll'){return {channels:[...this.channels.entries()].filter(([,c])=>!c.announced).map(([id,c])=>{c.announced=true;return id;})};}
  const c=p.channel&&this.channels.get(p.channel);if(!c)throw Error('网络流已失效');
  if(method==='network.proxy.read'){const data=c.data.subarray(0,65536);c.data=c.data.subarray(data.length);if(c.data.length<131072)c.socket.resume();return {data:data.toString('base64'),ended:c.ended&&c.data.length===0};}
  if(method==='network.proxy.write'){if(p.data===undefined)throw Error('缺少网络数据');const b=Buffer.from(p.data,'base64');if(b.length>65536)throw Error('网络数据过大');await new Promise<void>((ok,fail)=>{const timer=setTimeout(()=>{c.socket.destroy();fail(Error('网络写入超时'));},5000);c.socket.write(b,e=>{clearTimeout(timer);e?fail(e):ok();});});return {written:b.length};}
  if(method==='network.proxy.close'){c.socket.destroy();this.channels.delete(p.channel!);return{closed:true};}throw Error('未知网络代理操作');
 }
 async open(host:string,port:number,signal:AbortSignal){if(!this.lease||!this.selected||this.lease.until<Date.now()||!this.allowed(this.lease.owner))throw Error('所选网络出口不可用，未回退直连');const generation=this.generation;return new Promise<Socket>((ok,fail)=>{const req=request({host:'127.0.0.1',port:this.lease!.port,method:'CONNECT',path:(host.includes(':')?'['+host+']':host)+':'+port,signal});req.setTimeout(15000,()=>req.destroy(Error('网络出口超时')));req.once('error',fail);req.once('connect',(res,socket,head)=>{if(res.statusCode!==200||generation!==this.generation){socket.destroy();fail(Error('网络出口不可用'));return;}if(head.length)socket.unshift(head);ok(socket);});req.end();});}
 readonly fetch:typeof fetch=tunnelFetch((host,port,signal)=>this.open(host,port,signal));
 async close(){return this.serial(()=>this.closeNow());}
 private async closeNow(){this.generation++;const lease=this.lease;this.lease=undefined;for(const c of this.channels.values())c.socket.destroy();this.channels.clear();if(lease)await new Promise<void>(r=>lease.server.close(()=>r()));}
 async dispose(){this.disposed=true;clearInterval(this.timer);await this.pending.catch(()=>{});await this.closeNow();}
}

