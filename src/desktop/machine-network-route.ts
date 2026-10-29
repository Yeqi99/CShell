import ssh2 from 'ssh2';
import { createHash } from 'node:crypto';
import type { Store } from '../core/store';
import type { ClientProvider } from '../core/client/provider';
import { createSshBrowserProxy, type Forward } from '../core/ssh-browser-proxy';
import { agentBrowserStream } from '../core/agent-browser-stream';

/** Owns dedicated transports; no terminal, browser cookie jar or system proxy is created. */
export class MachineNetworkRoute {
 private current?: {id:string; key:string; proxy:Awaited<ReturnType<typeof createSshBrowserProxy>>; validate():void; forward:Forward; close():void};
 private pending: Promise<unknown> = Promise.resolve();
 private closed=false;
 constructor(private store:Store, private agents:ClientProvider, private ancestors:readonly string[] = []) {}
 async list(){return this.store.snapshot().profiles.filter(p=>!p.protocol||p.protocol==='ssh'||p.protocol==='client').map(p=>({id:p.id,name:p.name}));}
 private key(id:string){const p=this.store.profile(id);return JSON.stringify([p.id,p.protocol,p.host,p.port,p.username,p.jumpProfileId,this.store.host(`${p.host.toLowerCase()}:${p.port}`),p.protocol==='client'?this.agents.list().find(d=>d.deviceId===id):null]);}
 proxy(id:string):Promise<string>{const run=this.pending.catch(()=>{}).then(()=>this.prepare(id));this.pending=run;return run;}
 private async prepare(id:string){
  if(this.ancestors.includes(id)||this.ancestors.length>=8)throw Error('网络跳板存在循环或超过八层');
  if(this.closed)throw Error('网络出口已关闭');
  const profile=this.store.profile(id),key=this.key(id);
  if(this.current?.id===id&&this.current.key===key){try{this.current.validate();return `socks5://127.0.0.1:${this.current.proxy.port}`;}catch{this.release();}}
  this.release();
  let forward:Forward,close:()=>void,validate:()=>void;
  if(profile.protocol==='client'){
   const transport=await this.agents.browserTransport(id);close=transport.close;validate=transport.validate;
   forward=(host,port,done)=>{try{validate();void agentBrowserStream(transport.call,host,port).then(s=>done(null,s),e=>done(e));}catch(e){done(e as Error);}};
  }else{
   if(profile.protocol&&profile.protocol!=='ssh')throw Error('此连接不支持机器网络出口');
   const pinned=this.store.host(`${profile.host.toLowerCase()}:${profile.port}`);if(!pinned)throw Error('请先连接这台 SSH 机器并核对身份，再选择网络出口');
   const secret=await this.store.secret(id);if(!secret)throw Error('请先保存此 SSH 连接的认证信息');
   let nested:MachineNetworkRoute|undefined;let sock:import('node:stream').Duplex|undefined;
   if(profile.jumpProfileId){nested=new MachineNetworkRoute(this.store,this.agents,[...this.ancestors,id]);try{sock=await nested.tunnel(profile.jumpProfileId,profile.host,profile.port);}catch(e){await nested.close();throw e;}}
   const client=new ssh2.Client();let alive=false;close=()=>{alive=false;client.destroy();void nested?.close();};validate=()=>{if(!alive)throw Error('机器网络出口已断开，未回退本机');};
   client.on('error',()=>{alive=false;});client.on('close',()=>{alive=false;});
   try{await new Promise<void>((resolve,reject)=>{client.once('error',reject);client.once('close',()=>reject(Error('SSH 出口连接关闭')));client.once('ready',()=>{alive=true;resolve();});client.connect({sock,host:profile.host,port:profile.port,username:profile.username,...secret,readyTimeout:15000,keepaliveInterval:15000,keepaliveCountMax:3,hostVerifier:(key:Buffer)=>'SHA256:'+createHash('sha256').update(key).digest('base64').replace(/=+$/,'')===pinned});});}catch(e){close();throw e;}
   forward=(host,port,done)=>{try{validate();client.forwardOut('127.0.0.1',0,host,port,(e,s)=>done(e??null,s));}catch(e){done(e as Error);}};
  }
  try{
   const check=()=>{if(this.closed||this.key(id)!==key)throw Error('机器身份或连接设置已更改，请重新选择出口');validate();};check();
   const proxy=await createSshBrowserProxy((host,port,done)=>{try{check();forward(host,port,done);}catch(e){done(e as Error);}});
   try{check();}catch(e){proxy.close();throw e;}
   this.current={id,key,proxy,validate:check,forward,close};return `socks5://127.0.0.1:${proxy.port}`;
  }catch(e){close();throw e;}
 }
 async tunnel(id:string,host:string,port:number){await this.proxy(id);const current=this.current!;current.validate();return new Promise<import('node:stream').Duplex>((resolve,reject)=>current.forward(host,port,(error,stream)=>{if(error||!stream){reject(error??Error('跳板没有返回传输通道'));return;}try{current.validate();resolve(stream);}catch(e){stream.destroy();reject(e);}}));}
 private release(){const current=this.current;this.current=undefined;current?.proxy.close();current?.close();}
 async close(){this.closed=true;this.release();await this.pending.catch(()=>{});this.release();}
}
