import {Client,type FileInfo} from 'basic-ftp';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {isIP} from 'node:net';
import {posix} from 'node:path';
import {lstat,copyFile,rm} from 'node:fs/promises';
import {constants,createWriteStream} from 'node:fs';
import {Readable,Writable} from 'node:stream';
import type {FileEntry,SessionEvent} from '../shared/contracts';

const line=z.string().min(1).max(4096).refine(value=>!/[\r\n\0]/.test(value),'FTP 字段不能包含控制字符');
export const ftpConfiguration=z.object({id:z.string().uuid(),name:z.string().max(120).optional(),protocol:z.enum(['ftp','ftps']),host:line.max(253),port:z.number().int().min(1).max(65535),username:line.max(255)});
export type FtpProfile=z.infer<typeof ftpConfiguration>;
export type FtpAction={action:'mkdir'|'rename'|'delete';path:string;destination?:string;directory?:boolean};
type Progress=(done:number,total:number)=>void;
type Session={profile:FtpProfile;home:string;client:Client;tail:Promise<unknown>};
const checkedPath=(home:string,path:string)=>posix.resolve(home,line.parse(path));
const entry=(directory:string,file:FileInfo):FileEntry=>({name:file.name,path:posix.join(directory,file.name),directory:file.isDirectory,symlink:file.isSymbolicLink,size:file.size,modified:file.modifiedAt?.getTime()??0});

/** Explicit FTP/FTPS transport. One control command sequence per connection,
 * no PTY and no implicit reconnect after a possibly completed mutation. */
export class FtpService {
 private sessions=new Map<string,Session>();
 get size(){return this.sessions.size;}
 constructor(private emit:(event:SessionEvent)=>void,private options:{ca?:string|string[];timeoutMs?:number}={}){}
 has(id:string){return this.sessions.has(id);}
 get(id:string){const session=this.sessions.get(id);if(!session||session.client.closed)throw Error('文件连接已断开，请重新连接');return session;}
 async connect(configuration:unknown,credentials:{password?:string},signal=new AbortController().signal,ready?:(id:string)=>void){
  const profile=ftpConfiguration.parse(configuration),password=z.string().max(65536).refine(v=>!/[\r\n\0]/.test(v),'FTP 密码不能包含控制字符').parse(credentials.password??'');
  signal.throwIfAborted();const client=new Client(this.options.timeoutMs??30000,{allowSeparateTransferHost:false,maxListingBytes:2*1024*1024});
  client.ftp.verbose=false;const abort=()=>client.close();signal.addEventListener('abort',abort,{once:true});
  let id:string|undefined;
  try{
   await client.access({host:profile.host,port:profile.port,user:profile.username,password,secure:profile.protocol==='ftps',secureOptions:{rejectUnauthorized:true,minVersion:'TLSv1.2',...(isIP(profile.host)?{}:{servername:profile.host}),...(this.options.ca?{ca:this.options.ca}:{})}});
   // Do not accept a server silently declining private data connections.
   if(profile.protocol==='ftps'){await client.send('PBSZ 0');await client.send('PROT P');}
   signal.throwIfAborted();const home=checkedPath('/',await client.pwd());id=randomUUID();
   this.sessions.set(id,{profile,home,client,tail:Promise.resolve()});const sessionId=id;
   // basic-ftp removes socket listeners inside its end/error handlers. Observe
   // before those handlers, but let the library finish recording the cause and
   // rejecting its active operation before notifying the workspace.
   const disconnected=()=>queueMicrotask(()=>this.disconnect(sessionId,'文件连接已断开；未自动重新执行操作'));
   for(const event of ['end','error','timeout','close'])client.ftp.socket.prependOnceListener(event,disconnected);
   // A malformed control response can close the context during a data event.
   client.ftp.socket.on('data',()=>{if(client.closed)disconnected();});
   ready?.(id);return{sessionId:id,home};
  }catch(error){if(id)this.disconnect(id);else client.close();signal.throwIfAborted();const message=error instanceof Error?error.message:'文件连接失败';throw Error(password?message.replaceAll(password,'[已隐藏]'):message);}
  finally{signal.removeEventListener('abort',abort);}
 }
 disconnect(id:string,error?:string){const session=this.sessions.get(id);if(!session)return;this.sessions.delete(id);session.client.close();this.emit({type:'closed',sessionId:id,...(error?{error}:{})});}
 dispose(){for(const id of this.sessions.keys())this.disconnect(id);}
 private run<T>(id:string,signal:AbortSignal|undefined,operation:(client:Client,session:Session)=>Promise<T>,mutation=false){
  const session=this.get(id);
  const result=session.tail.catch(()=>{}).then(async()=>{
   signal?.throwIfAborted();if(this.get(id)!==session)throw Error('文件连接已改变');
   const abort=()=>this.disconnect(id,'传输已取消；请检查远端操作是否完成');signal?.addEventListener('abort',abort,{once:true});
   try{return await operation(session.client,session);}catch(error){
    if(session.client.closed)this.disconnect(id,'文件连接已断开；未自动重新执行操作');
    signal?.throwIfAborted();
    if(mutation&&session.client.closed)throw Error('连接中断，操作结果未确认；请检查目标后再决定是否重试');
    throw error;
   }finally{signal?.removeEventListener('abort',abort);}
  });session.tail=result;return result;
 }
 private async listing(client:Client,path:string){
  const files=await client.list(path);if(files.length>10000)throw Error('目录条目超过 10000，请打开更具体的目录');
  return files.filter(file=>file.name!=='.'&&file.name!=='..').map(file=>{
   if(/[\/\\\r\n\0]/.test(file.name)||file.name.length>1024)throw Error('服务器返回了无效文件名');return entry(path,file);
  });
 }
 private async find(client:Client,path:string){return(await this.listing(client,posix.dirname(path))).find(item=>item.name===posix.basename(path));}
 list(id:string,path:string,signal?:AbortSignal){return this.run(id,signal,async(client,s)=>{const full=checkedPath(s.home,path);return{path:full,entries:await this.listing(client,full)};});}
 action(id:string,input:FtpAction,signal?:AbortSignal,guard?:()=>void){
  const p=z.object({action:z.enum(['mkdir','rename','delete']),path:line,destination:line.optional(),directory:z.boolean().optional()}).strict().parse(input);
  return this.run(id,signal,async(client,s)=>{
   const path=checkedPath(s.home,p.path);if(path==='/')throw Error('不能修改文件服务器根目录');
   const found=await this.find(client,path);
   if(p.action==='mkdir'){if(found)throw Error('目标已存在');guard?.();await client.send('MKD '+path);return;}
   if(!found)throw Error('目标已不存在');if(found.symlink)throw Error('不自动修改符号链接');
   if(p.action==='rename'){
    if(p.directory!==undefined&&found.directory!==p.directory)throw Error('目标类型已改变');
    if(!p.destination)throw Error('缺少新路径');const target=checkedPath(s.home,p.destination);if(target==='/'||target===path)throw Error('请选择不同的新路径');
    if(await this.find(client,target))throw Error('目标已存在，原文件已保留');guard?.();await client.rename(path,target);return;
   }
   if(found.directory){if(!p.directory)throw Error('该目标是目录；仅允许明确删除空目录');if((await this.listing(client,path)).length)throw Error('目录不为空，不执行递归删除');guard?.();await client.send('RMD '+path);}
   else{if(p.directory)throw Error('目标类型已改变');guard?.();await client.remove(path);}
  },true);
 }
 private async put(client:Client,path:string,source:string|Readable,total:number,signal:AbortSignal|undefined,progress:Progress,guard?:()=>void){
  if(await this.find(client,path))throw Error('目标已存在，原文件已保留；请选择其他名称');
  const temporary=path+'.cshell-'+randomUUID()+'.part';let finished=false;
  try{
   client.trackProgress(info=>progress(info.bytes,total));guard?.();await client.uploadFrom(source,temporary);signal?.throwIfAborted();
   // FTP has no exclusive rename primitive. This is a checked, non-atomic
   // publish; external writers can race it. It is never retried automatically.
   if(await this.find(client,path))throw Error('上传期间目标已出现，原文件已保留');guard?.();await client.rename(temporary,path);finished=true;progress(total,total);
  }finally{client.trackProgress();if(!finished&&!client.closed)await client.remove(temporary).catch(()=>{});}
 }
 upload(id:string,localPath:string,remotePath:string,signal?:AbortSignal,progress:Progress=()=>{}){
  return this.run(id,signal,async(client,s)=>{const file=await lstat(localPath);if(!file.isFile()||file.isSymbolicLink())throw Error('请选择一个普通文件，目录和链接不能作为单文件上传');await this.put(client,checkedPath(s.home,remotePath),localPath,file.size,signal,progress);},true);
 }
 writeText(id:string,path:string,content:string,signal?:AbortSignal,guard?:()=>void){
  const data=Buffer.from(content);if(data.length>262144)throw Error('文本写入限 256 KiB');
  return this.run(id,signal,(client,s)=>this.put(client,checkedPath(s.home,path),Readable.from(data),data.length,signal,()=>{},guard),true);
 }
 download(id:string,remotePath:string,localPath:string,signal?:AbortSignal,progress:Progress=()=>{}){
  return this.run(id,signal,async(client,s)=>{
   const path=checkedPath(s.home,remotePath),file=await this.find(client,path);if(!file||file.directory||file.symlink)throw Error('请选择一个普通文件');
   const temporary=localPath+'.cshell-'+randomUUID()+'.part';const stream=createWriteStream(temporary,{flags:'wx',mode:0o600});
   try{client.trackProgress(info=>progress(info.bytes,file.size));await client.downloadTo(stream,path);signal?.throwIfAborted();await copyFile(temporary,localPath,constants.COPYFILE_EXCL);progress(file.size,file.size);}
   finally{client.trackProgress();stream.destroy();await rm(temporary,{force:true});}
  });
 }
 readText(id:string,path:string,signal?:AbortSignal){
  return this.run(id,signal,async(client,s)=>{
   const full=checkedPath(s.home,path),file=await this.find(client,full);if(!file||file.directory||file.symlink)throw Error('请选择一个普通文件');if(file.size>65536)throw Error('文本读取限 64 KiB，请使用文件下载');
   const chunks:Buffer[]=[];let size=0;const sink=new Writable({write(chunk,_encoding,done){size+=chunk.length;if(size>65536){done(Error('文件超过文本读取上限'));return;}chunks.push(Buffer.from(chunk));done();}});
   await client.downloadTo(sink,full);return{path:full,content:Buffer.concat(chunks).toString('utf8'),bytes:size};
  });
 }
}
