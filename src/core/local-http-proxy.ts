import {createServer,request,Agent} from 'node:http';
import type {Duplex} from 'node:stream';
import type {HttpTunnel} from './http-transport';
/** Loopback HTTP proxy; its only network path is the selected authenticated tunnel. */
export async function localHttpProxy(tunnel:HttpTunnel){
 const sockets=new Set<Duplex>();const abort=new AbortController();
 const track=(s:Duplex)=>{sockets.add(s);s.once('close',()=>sockets.delete(s));s.on('error',()=>{});return s;};
 const server=createServer({maxHeaderSize:16384});
 server.on('connection',socket=>{if(sockets.size>=128){socket.destroy();return;}track(socket);});
 server.on('connect',(req,client,head)=>{void(async()=>{try{
  const url=new URL('https://'+req.url);if(url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Invalid CONNECT');
  const upstream=track(await tunnel(url.hostname,Number(url.port||443),abort.signal));
  if(client.destroyed){upstream.destroy();return;}client.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)upstream.write(head);client.pipe(upstream).pipe(client);client.once('close',()=>upstream.destroy());upstream.once('close',()=>client.destroy());
 }catch{client.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');}})();});
 server.on('request',(req,res)=>{void(async()=>{try{
  const url=new URL(req.url??'');if(url.protocol!=='http:'||url.username||url.password)throw Error('Invalid request');
  const upstream=track(await tunnel(url.hostname,Number(url.port||80),abort.signal));if(req.destroyed){upstream.destroy();return;}
  const headers:import('node:http').OutgoingHttpHeaders={...req.headers,host:url.host};delete headers['proxy-authorization'];delete headers['proxy-connection'];
  const agent=new Agent({keepAlive:false});agent.createConnection=()=>upstream as any;
  const forward=request(url,{method:req.method,headers,agent},reply=>{res.writeHead(reply.statusCode??502,reply.headers);reply.pipe(res);});
  forward.once('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});res.once('close',()=>{forward.destroy();agent.destroy();upstream.destroy();});req.pipe(forward);
 }catch{res.writeHead(502);res.end();}})();});
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 return {port:(server.address() as import('node:net').AddressInfo).port,close:()=>{abort.abort();for(const socket of sockets)socket.destroy();sockets.clear();server.close();}};
}
