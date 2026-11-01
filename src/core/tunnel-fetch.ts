import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import {isIP} from 'node:net';
import {Readable} from 'node:stream';
import type {HttpTunnel} from './http-transport';
/** Streaming fetch over an explicit tunnel. Redirects never silently change destinations. */
export function tunnelFetch(tunnel:HttpTunnel):typeof fetch {
 return async(input,init)=>{
  if(typeof input!=='string'&&!(input instanceof URL))throw Error('代理请求必须使用明确URL');
  const url=new URL(String(input));
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('不支持的代理请求地址');
  if(init?.body!==undefined&&typeof init.body!=='string')throw Error('不支持的代理请求内容');
  const signal=init?.signal??AbortSignal.timeout(120000);signal.throwIfAborted();
  const host=url.hostname.replace(/^\[|\]$/g,''),secure=url.protocol==='https:';
  const socket=await tunnel(host,Number(url.port||(secure?443:80)),signal);
  if(signal.aborted){socket.destroy();signal.throwIfAborted();}
  const connected=secure?tls.connect({socket:socket as any,servername:isIP(host)?undefined:host,rejectUnauthorized:true,checkServerIdentity:(_name,cert)=>tls.checkServerIdentity(host,cert)}):socket;
  const agent=secure?new https.Agent({keepAlive:false}):new http.Agent({keepAlive:false});
  agent.createConnection=()=>connected as any;
  return new Promise<Response>((resolve,reject)=>{
   const req=(secure?https:http).request(url,{method:init?.method??'GET',headers:Object.fromEntries(new Headers(init?.headers).entries()),signal,agent},res=>{
    const status=res.statusCode??500;
    if(status>=300&&status<400&&init?.redirect==='error'){res.destroy();agent.destroy();reject(Error('代理请求不允许重定向'));return;}
    const headers=new Headers();for(const [name,value] of Object.entries(res.headers))if(value!==undefined)headers.set(name,Array.isArray(value)?value.join(', '):value);
    res.once('close',()=>{agent.destroy();socket.destroy();});
    if([204,205,304].includes(status))res.resume();
    resolve(new Response([204,205,304].includes(status)?null:Readable.toWeb(res) as ReadableStream<Uint8Array>,{status,headers}));
   });
   req.once('error',error=>{agent.destroy();socket.destroy();reject(error);});req.end(init?.body);
  });
 };
}
