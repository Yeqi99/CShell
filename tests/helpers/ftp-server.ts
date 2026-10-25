import {createServer,type Socket} from 'node:net';
import {createSecureContext,TLSSocket,createServer as createTlsServer} from 'node:tls';
import {posix} from 'node:path';

/** Loopback protocol fixture: actual control/data sockets, AUTH TLS and PROT P.
 * It does not touch a user's machine or depend on a system FTP installation. */
export async function ftpFixture(certificate?:{cert:string;key:string}){
 const files=new Map<string,Buffer>([['/hello.txt',Buffer.from('hello 中文\n')],['/docs/note.txt',Buffer.from('note')]]),dirs=new Set(['/','/docs']);
 const commands:string[]=[],sockets=new Set<Socket>(),passiveServers=new Set<ReturnType<typeof createServer>>();
 const state={dropRename:false,slowDownload:false,tlsDataConnections:0,redirectPassive:false};
 const server=createServer(raw=>{
  let control:Socket=raw,buffer='',secure=false,privateData=false,renameFrom='';let pending:Promise<Socket>|undefined;
  sockets.add(raw);raw.on('close',()=>sockets.delete(raw));raw.on('error',()=>{});
  const reply=(text:string)=>{if(!control.destroyed)control.write(text+'\r\n');};
  const bind=()=>{control.on('error',()=>{});control.on('data',data=>{buffer+=data.toString();let newline:number;while((newline=buffer.indexOf('\r\n'))>=0){const line=buffer.slice(0,newline);buffer=buffer.slice(newline+2);void command(line).catch(()=>reply('451 fixture error'));}});};
  async function transfer(content:Buffer){reply('150 Opening data');const socket=await pending!;
   if(state.slowDownload){let offset=0;const timer=setInterval(()=>{if(socket.destroyed){clearInterval(timer);return;}const end=Math.min(offset+16384,content.length);socket.write(content.subarray(offset,end));offset=end;if(offset===content.length){clearInterval(timer);socket.end();}},30);socket.once('close',()=>clearInterval(timer));}
   else socket.end(content);
   socket.once('close',()=>reply('226 Transfer complete'));
  }
  async function command(line:string){const split=line.indexOf(' '),name=(split<0?line:line.slice(0,split)).toUpperCase(),arg=split<0?'':line.slice(split+1);commands.push(name==='PASS'?'PASS [hidden]':line);
   if(name==='AUTH'){
    if(!certificate){reply('502 TLS unavailable');return;}
    reply('234 Proceed with TLS');control.removeAllListeners('data');
    const tls=new TLSSocket(control,{isServer:true,secureContext:createSecureContext(certificate)});control=tls;secure=true;bind();return;
   }
   if(name==='USER'){reply('331 Password required');return;}if(name==='PASS'){reply('230 Logged in');return;}
   if(name==='FEAT'){reply('211-Features\r\n MLST type*;size*;modify*;\r\n UTF8\r\n211 End');return;}
   if(['OPTS','TYPE','STRU','PBSZ'].includes(name)){reply('200 OK');return;}
   if(name==='PROT'){if(!secure){reply('534 TLS required');return;}privateData=arg==='P';reply('200 Private data');return;}
   if(name==='PWD'){reply('257 "/" is current');return;}
   if(name==='EPSV'){
    if(state.redirectPassive){reply('502 EPSV unavailable');return;}
    let accept!:(socket:Socket)=>void;pending=new Promise(resolve=>{accept=resolve;});
    const onData=(socket:Socket)=>{sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));if(socket instanceof TLSSocket)state.tlsDataConnections++;accept(socket);};
    const passive=privateData?createTlsServer(certificate!,onData):createServer(onData);passive.on('tlsClientError',()=>{});passive.on('error',()=>{});passiveServers.add(passive);
    await new Promise<void>(resolve=>passive.listen(0,'127.0.0.1',resolve));const address=passive.address() as {port:number};reply('229 Entering Extended Passive Mode (|||'+address.port+'|)');return;
   }
   if(name==='PASV'&&state.redirectPassive){reply('227 Entering Passive Mode (8,8,8,8,0,21)');return;}
   if(name==='MLSD'||name==='LIST'){
    const path=posix.resolve('/',arg||'/');if(!dirs.has(path)){reply('550 Directory missing');return;}
    const children=[...dirs].filter(p=>p!==path&&posix.dirname(p)===path).map(p=>'type=dir;size=0;modify=20261025120000; '+posix.basename(p));
    children.push(...[...files].filter(([p])=>posix.dirname(p)===path).map(([p,b])=>'type=file;size='+b.length+';modify=20261025120000; '+posix.basename(p)));
    await transfer(Buffer.from(children.join('\r\n')+'\r\n'));return;
   }
   if(name==='RETR'){const file=files.get(arg);if(!file){reply('550 File missing');return;}await transfer(file);return;}
   if(name==='STOR'){reply('150 Ready to receive');const socket=await pending!,chunks:Buffer[]=[];socket.on('data',b=>chunks.push(Buffer.from(b)));socket.on('end',()=>{files.set(arg,Buffer.concat(chunks));socket.end();reply('226 Stored');});return;}
   if(name==='MKD'){if(dirs.has(arg)||files.has(arg)){reply('550 Exists');return;}dirs.add(arg);reply('257 Created');return;}
   if(name==='RMD'){if([...dirs,...files.keys()].some(p=>p!==arg&&p.startsWith(arg+'/'))){reply('550 Not empty');return;}dirs.delete(arg);reply('250 Removed');return;}
   if(name==='DELE'){if(!files.delete(arg)){reply('550 Missing');return;}reply('250 Deleted');return;}
   if(name==='RNFR'){if(!files.has(arg)&&!dirs.has(arg)){reply('550 Missing');return;}renameFrom=arg;reply('350 RNTO required');return;}
   if(name==='RNTO'){if(files.has(renameFrom)){files.set(arg,files.get(renameFrom)!);files.delete(renameFrom);}else{dirs.delete(renameFrom);dirs.add(arg);}renameFrom='';if(state.dropRename){control.destroy();return;}reply('250 Renamed');return;}
   if(name==='QUIT'){reply('221 Bye');control.end();return;}reply('502 Unsupported');
  }
  bind();reply('220 Fixture ready');
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 return{files,dirs,commands,state,port:(server.address() as {port:number}).port,disconnectAll(){for(const socket of sockets)socket.destroy();},async close(){for(const socket of sockets)socket.destroy();await Promise.all([...passiveServers,server].map(s=>new Promise<void>(resolve=>s.close(()=>resolve()))));}};
}
