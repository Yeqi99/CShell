import { request, Agent } from 'node:https';
import { request as httpRequest } from 'node:http';
import { connect as tlsConnect } from 'node:tls';
import { Readable } from 'node:stream';
import {systemUpdateProxy,parseUpdateProxy} from './update-proxy';

/** Per-request tunnel; proxy failure never falls through to a direct connection. */
export async function updateRequest(url: string, options: { signal: AbortSignal; headers?: Record<string,string>; proxy?:string|null }): Promise<Response> {
 options.signal.throwIfAborted();
 const proxy=options.proxy===null?undefined:options.proxy!==undefined?parseUpdateProxy(options.proxy):await systemUpdateProxy(url);
 options.signal.throwIfAborted();
 const agent=proxy?new Agent({keepAlive:false}):undefined;
 if(agent){agent.createConnection=((_settings:any,callback:any)=>{
  const p=new URL(proxy!),target=new URL(url);
  const connectRequest=(p.protocol==='https:'?request:httpRequest)(p,{method:'CONNECT',path:target.hostname+':'+(target.port||443),agent:false,signal:options.signal,maxHeaderSize:16384,headers:{Host:target.hostname+':'+(target.port||443),...(p.username?{'Proxy-Authorization':'Basic '+Buffer.from(decodeURIComponent(p.username)+':'+decodeURIComponent(p.password)).toString('base64')}:{})}});
  let completed=false;
  const fail=(error:Error)=>{if(!completed){completed=true;callback(error);}};
  connectRequest.once('error',fail);
  connectRequest.once('connect',(response,socket,head)=>{
   if(response.statusCode!==200||head.length){socket.destroy();fail(Error('更新代理隧道连接失败'));return;}
   const secure=tlsConnect({socket,servername:target.hostname,rejectUnauthorized:true});
   const abort=()=>secure.destroy(options.signal.reason instanceof Error ? options.signal.reason : new DOMException('Update request aborted','AbortError'));
   options.signal.addEventListener('abort',abort,{once:true});secure.once('close',()=>options.signal.removeEventListener('abort',abort));
   secure.once('error',fail);secure.once('secureConnect',()=>{if(!completed){completed=true;callback(null,secure);}});
   if(options.signal.aborted)abort();
  });connectRequest.end();return undefined;
 }) as typeof agent.createConnection;}
 return new Promise((resolve,reject)=>{
  const req=request(url,{method:'GET',agent:agent??false,signal:options.signal,headers:options.headers},response=>{
   const status=response.statusCode??500;
   if(status!==200){response.resume();req.destroy();agent?.destroy();resolve(new Response(null,{status,headers:response.headers.location?{location:response.headers.location}:undefined}));return;}
   response.once('close',()=>agent?.destroy());
   resolve(new Response(Readable.toWeb(response) as ReadableStream<Uint8Array>,{status}));
  });req.once('error',error=>{agent?.destroy();reject(options.signal.aborted ? options.signal.reason : error);});req.end();
 });
}
