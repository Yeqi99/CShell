import {randomUUID} from 'node:crypto';
import type {ClientChannel} from 'ssh2';
import {z} from 'zod';
import type {SshService} from '../core/ssh';
import {RemoteJobs,quote} from '../core/remote-jobs';
import {nativeDesktopSetup} from '../core/native-desktop-setup';

export const nativeDesktopEndpoint = z.union([
  z.object({port:z.number().int().min(5900).max(5999)}).strict(),
  z.object({socket:z.string().max(240).regex(/^\/(?:home|run|tmp)\/[a-zA-Z0-9_./-]+$/).refine(s=>!s.split('/').includes('..'))}).strict(),
]);
type Connection = {session:string; stream:ClientChannel; queue:Buffer[]; bytes:number; ended:boolean; wake?:()=>void; reading:boolean};
/** RFB travels through the existing authenticated SSH connection, never a public local proxy. */
export class NativeDesktopService {
  private connections=new Map<string,Connection>();
  constructor(private ssh:SshService){}
  async setup(session:string,action:unknown){
    const operation=z.enum(['inspect','start','install-start','stop']).parse(action);
    const source=this.ssh.get(session);
    if(source.profile.protocol && source.profile.protocol!=='ssh')throw Error('需要 SSH 连接');
    return JSON.parse(await new RemoteJobs(this.ssh).exec(session,'python3 -c '+quote(nativeDesktopSetup)+' '+quote(operation),undefined,operation==='install-start'?240000:20000));
  }
  async open(session:string,input:unknown){
    const endpoint=nativeDesktopEndpoint.parse(input), source=this.ssh.get(session);
    if(source.profile.protocol && source.profile.protocol!=='ssh')throw Error('原生桌面需要 SSH 连接');
    if(this.connections.size>=8)throw Error('请先关闭不用的原生桌面');
    const stream=await new Promise<ClientChannel>((resolve,reject)=>{
      let settled=false;
      const timer=setTimeout(()=>{settled=true;reject(Error('桌面服务连接超时'));},10000);
      const done=(error:Error|undefined,channel:ClientChannel)=>{if(settled){channel?.destroy();return;}settled=true;clearTimeout(timer);error?reject(Error('无法连接桌面服务，请检查服务地址')):resolve(channel);};
      if('socket' in endpoint)source.client.openssh_forwardOutStreamLocal(endpoint.socket,done);
      else source.client.forwardOut('127.0.0.1',0,'127.0.0.1',endpoint.port,done);
    });
    try{this.ssh.get(session);}catch(e){stream.destroy();throw e;}
    const id=randomUUID(),c:Connection={session,stream,queue:[],bytes:0,ended:false,reading:false};
    this.connections.set(id,c);
    stream.on('data',(data:Buffer)=>{c.queue.push(Buffer.from(data));c.bytes+=data.length;if(c.bytes>4*1024*1024)stream.pause();if(c.bytes>16*1024*1024){this.close(id);return;}c.wake?.();});
    const ended=()=>{c.ended=true;c.wake?.();};
    stream.on('close',ended);stream.on('end',ended);stream.on('error',ended);
    return id;
  }
  async read(id:string){
    const c=this.connections.get(id);if(!c)return null;
    if(c.reading)throw Error('已有桌面读取请求');
    c.reading=true;
    try{
      this.ssh.get(c.session);
      if(!c.queue.length&&!c.ended)await new Promise<void>(resolve=>{const timer=setTimeout(()=>{c.wake=undefined;resolve();},15000);c.wake=()=>{clearTimeout(timer);c.wake=undefined;resolve();};});
      if(c.queue.length){const data=Buffer.concat(c.queue);c.queue=[];c.bytes=0;c.stream.resume();return new Uint8Array(data);}
      if(c.ended){this.close(id);return null;}return new Uint8Array();
    }catch(e){this.close(id);throw e;}finally{c.reading=false;}
  }
  async write(id:string,data:unknown){
    const c=this.connections.get(id);if(!c||c.ended)throw Error('桌面已断开');
    this.ssh.get(c.session);
    if(!(data instanceof Uint8Array)||data.byteLength>1024*1024)throw Error('无效桌面输入');
    await new Promise<void>((resolve,reject)=>c.stream.write(Buffer.from(data),error=>error?reject(Error('桌面输入失败')):resolve()));
  }
  close(id:string){const c=this.connections.get(id);if(!c)return;c.ended=true;c.wake?.();c.stream.destroy();this.connections.delete(id);}
  dispose(){for(const id of this.connections.keys())this.close(id);}
}
