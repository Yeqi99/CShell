import {PassThrough,Readable,Writable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {randomUUID} from 'node:crypto';
import type {SFTPWrapper,Stats} from 'ssh2';
import type {FtpService} from './ftp';
import {posix} from 'node:path';

/** Per-copy adapter: no credentials, reconnect, shell commands or Agent install. */
export function providerFileCall(provider:{sftp?:SFTPWrapper;ftp?:FtpService;sessionId:string},parentSignal:AbortSignal){
 const controller=new AbortController(),signal=controller.signal;const forward=()=>controller.abort();parentSignal.addEventListener('abort',forward,{once:true});if(parentSignal.aborted)forward();
 let readingCompletion:Promise<unknown>|undefined;
 let reader:Readable|undefined,iterator:AsyncIterator<any>|undefined,size=0,version='',offset=0;
 let writer:Writable|undefined,completion:Promise<unknown>|undefined,temporary='',destination='',upload='',written=0,expected=0;
 const stat=(path:string)=>new Promise<Stats>((resolve,reject)=>provider.sftp!.lstat(path,(e,s)=>e?reject(e):resolve(s)));
 const exists=async(path:string)=>{try{await stat(path);return true;}catch(e){if((e as any).code===2)return false;throw e;}};
 const cleanup=async()=>{controller.abort();reader?.destroy();writer?.destroy();await completion?.catch(()=>{});if(temporary&&provider.sftp)await new Promise<void>(r=>provider.sftp!.unlink(temporary,()=>r()));};
 const abort=()=>{reader?.destroy(Error('Transfer cancelled'));writer?.destroy(Error('Transfer cancelled'));};signal.addEventListener('abort',abort,{once:true});
 const call=async(method:string,raw:unknown)=>{
  signal.throwIfAborted();const p=raw as any;
  if(method==='files.list'){
   if(provider.sftp){const info=await stat(p.path);if(!info.isDirectory()||info.isSymbolicLink())throw Error('Source is not a regular directory');const rows=await new Promise<any[]>((r,j)=>provider.sftp!.readdir(p.path,(e,v)=>e?j(e):r(v)));if(rows.length>10000)throw Error('Directory too large');return {entries:rows.map(row=>({name:row.filename,directory:row.attrs.isDirectory(),symlink:row.attrs.isSymbolicLink(),size:row.attrs.size}))};}
   if(p.path!=='/'){const parent=await provider.ftp!.list(provider.sessionId,posix.dirname(p.path),signal);const info=parent.entries.find(e=>e.name===posix.basename(p.path));if(!info?.directory||info.symlink)throw Error('Source is not a regular directory');}
   return provider.ftp!.list(provider.sessionId,p.path,signal);
  }
  if(method==='files.action'&&p.action==='mkdir'){
   if(provider.sftp){if(await exists(p.path))throw Error('Destination already exists; original preserved');await new Promise<void>((r,j)=>provider.sftp!.mkdir(p.path,{mode:0o700},e=>e?j(e):r()));}
   else await provider.ftp!.action(provider.sessionId,{action:'mkdir',path:p.path},signal);
   return {ok:true};
  }
  if(method==='files.read'){
   if(!iterator){
    if(provider.sftp){const s=await stat(p.path);if(!s.isFile()||s.isSymbolicLink())throw Error('Only regular files can be copied');size=s.size;version=`${s.size}:${s.mtime}`;reader=provider.sftp.createReadStream(p.path,{highWaterMark:65536});}
    else {const listed=await provider.ftp!.list(provider.sessionId,posix.dirname(p.path),signal);const s=listed.entries.find(e=>e.name===posix.basename(p.path));if(!s||s.directory||s.symlink)throw Error('Only regular files can be copied');size=s.size;version=`${s.size}:${s.modified}`;reader=new PassThrough({highWaterMark:65536});readingCompletion=provider.ftp!.streamDownload(provider.sessionId,p.path,reader as PassThrough,signal);void readingCompletion.catch(e=>reader!.destroy(e));}
    reader.on('error',()=>{});iterator=reader[Symbol.asyncIterator]();
   }
   if(p.offset!==offset||(p.version!==undefined&&p.version!==version))throw Error('Source offset changed');
   const next=await iterator.next();const bytes=next.done?Buffer.alloc(0):Buffer.from(next.value);offset+=bytes.length;
   if(offset>size)throw Error('Source size changed');
   if(next.done){if(offset!==size)throw Error('Source file incomplete');await readingCompletion;if(provider.sftp){const after=await stat(p.path);if(`${after.size}:${after.mtime}`!==version)throw Error('Source file changed');}}
   // Finish only after EOF, so stream errors and a changing source are observed.
   return {data:bytes.toString('base64'),size,version,next:offset,done:!!next.done};
  }
  if(method==='files.uploadStart'){
   if(upload)throw Error('Upload already active');expected=p.size;destination=p.path;upload=randomUUID();writer=new PassThrough({highWaterMark:65536});writer.on('error',()=>{});
   if(provider.sftp){if(await exists(destination))throw Error('Destination already exists; original preserved');temporary=destination+'.cshell-'+upload+'.part';completion=pipeline(writer as PassThrough,provider.sftp.createWriteStream(temporary,{flags:'wx',mode:0o600,highWaterMark:65536}),{signal});}
   else completion=provider.ftp!.streamUpload(provider.sessionId,destination,writer as PassThrough,expected,signal);
   // Attach immediately: remote rejection may precede the next IPC chunk.
   void completion.catch(e=>writer?.destroy(e));return {id:upload,chunkSize:65536};
  }
  if(p.id!==upload||!upload)throw Error('Unknown transfer');
  if(method==='files.uploadChunk'){
   const bytes=Buffer.from(p.data,'base64');if(bytes.length>65536||p.offset!==written||written+bytes.length>expected)throw Error('Invalid upload chunk');
   await Promise.race([new Promise<void>((r,j)=>writer!.write(bytes,e=>e?j(e):r())),completion!.then(()=>{throw Error('Upload ended before all chunks');})]);written+=bytes.length;return{next:written};
  }
  if(method==='files.uploadFinish'){
   if(written!==expected)throw Error('Incomplete upload');writer!.end();await completion;signal.throwIfAborted();
   if(provider.sftp){if(await exists(destination))throw Error('Destination appeared; original preserved');await new Promise<void>((r,j)=>provider.sftp!.rename(temporary,destination,e=>e?j(e):r()));temporary='';}
   upload='';return{};
  }
  if(method==='files.uploadCancel'){await cleanup();upload='';return{};}
  throw Error('Unsupported file transfer operation');
 };
 return {call,dispose:async()=>{parentSignal.removeEventListener('abort',forward);await cleanup();signal.removeEventListener('abort',abort);}};
}
