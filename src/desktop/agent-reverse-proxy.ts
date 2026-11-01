import {connect,type Socket} from 'node:net';
import {localHttpProxy} from '../core/local-http-proxy';
import type {HttpTunnel} from '../core/http-transport';
export type ReverseProxyTransport={call(method:string,params?:unknown):Promise<unknown>;validate():void;close():void};
/** Polling carries only bounded stream chunks over the authenticated controller channel. */
export async function agentReverseProxy(transport:ReverseProxyTransport,tunnel:HttpTunnel,binding?:string){
 const proxy=await localHttpProxy(tunnel);let closed=false;const sockets=new Set<Socket>();
 let id:string;let port:number;
 try{const result=await transport.call('network.proxy.start',binding?{binding}:{}) as {id:string;port:number};id=result.id;port=result.port;if(!id||!Number.isInteger(port))throw Error('代理启动响应无效');}catch(e){proxy.close();transport.close();throw e;}
 const wait=(ms:number)=>new Promise<void>(r=>{const timer=setTimeout(r,ms);timer.unref();});
 const pipe=async(channel:string)=>{const socket=connect({host:'127.0.0.1',port:proxy.port});sockets.add(socket);socket.on('error',()=>{});let writes=Promise.resolve();
  socket.on('data',raw=>{const data=Buffer.from(raw);socket.pause();writes=writes.then(async()=>{for(let offset=0;offset<data.length;offset+=65536)await transport.call('network.proxy.write',{id,channel,data:data.subarray(offset,offset+65536).toString('base64')});if(!closed)socket.resume();}).catch(()=>{socket.destroy();});});
  try{while(!closed&&!socket.destroyed){transport.validate();const result=await transport.call('network.proxy.read',{id,channel}) as {data:string;ended:boolean};if(result.data){const bytes=Buffer.from(result.data,'base64');if(bytes.length>65536)throw Error('代理流超过限制');await new Promise<void>((ok,fail)=>socket.write(bytes,e=>e?fail(e):ok()));}if(result.ended){await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>{socket.destroy();reject(Error('代理响应超时'));},15000);const done=()=>{clearTimeout(timer);resolve();};socket.once('end',done);socket.once('close',done);socket.end();});await writes;break;}if(!result.data)await wait(25);}}
  catch{socket.destroy();}finally{sockets.delete(socket);socket.destroy();if(!closed)await transport.call('network.proxy.close',{id,channel}).catch(()=>{});}
 };
 let failure:unknown;const polling=(async()=>{try{while(!closed){transport.validate();const result=await transport.call('network.proxy.poll',{id}) as {channels:string[]};if(!Array.isArray(result.channels)||result.channels.length>64)throw Error('代理流超过限制');for(const channel of result.channels)void pipe(channel);await wait(100);}}catch(e){failure=e;for(const socket of sockets)socket.destroy();proxy.close();transport.close();}})();
 return{port,validate(){if(failure)throw failure;if(closed)throw Error('网络代理已关闭');transport.validate();},async close(remove=false){if(closed)return;closed=true;for(const socket of sockets)socket.destroy();proxy.close();if(remove)await transport.call('network.proxy.stop',{id}).catch(()=>{});transport.close();await polling;}};
}
