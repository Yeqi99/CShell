import {homedir} from 'node:os';
import {join,dirname} from 'node:path';
import {lstat,open,unlink,link} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {LocalFiles} from '../core/local-files';

// Base64 plus the RPC envelope must fit the 128 KiB transport frame.
const chunk=64*1024;
const location=z.object({root:z.string().uuid(),path:z.string().min(1).max(4096)});
type Upload={owner:string;temporary:string;target:string;offset:number;size:number;expires:number;busy:boolean};
/** Authenticated machine-management operations; OS account permissions still apply. */
export class AgentFiles {
 private fs=new LocalFiles();
 private roots?:Promise<{root:string;label:string}[]>;
 private uploads=new Map<string,Upload>();
 private timer=setInterval(()=>void this.expire(),60_000).unref();
 private async expire(){for(const [id,u] of this.uploads)if(!u.busy&&u.expires<Date.now()){this.uploads.delete(id);await unlink(u.temporary).catch(()=>{});}}
 async close(){clearInterval(this.timer);for(const u of this.uploads.values())await unlink(u.temporary).catch(()=>{});this.uploads.clear();}
 async call(method:string,params:unknown,owner:string,signal:AbortSignal):Promise<unknown>{
  signal.throwIfAborted();
  if(method==='files.roots'){
   this.roots??=(async()=>{const paths=[homedir()];if(process.platform==='win32'){for(let i=65;i<=90;i++){const p=String.fromCharCode(i)+':\\';if(await lstat(p).then(s=>s.isDirectory(),()=>false))paths.push(p);}}else paths.push('/');return Promise.all([...new Set(paths)].map(p=>this.fs.grant(p)));})();
   return {roots:await this.roots,chunkSize:chunk};
  }
  if(method==='files.list'){const p=location.strict().parse(params);return this.fs.list(p.root,p.path,()=>signal.throwIfAborted(),10000);}
  if(method==='files.action'){const p=location.extend({action:z.enum(['mkdir','rename','delete']),destination:z.string().max(4096).optional()}).strict().parse(params);await this.fs.action(p.root,p.action,p.path,p.destination);return {ok:true};}
  if(method==='files.read'){
   const p=location.extend({offset:z.number().int().nonnegative(),version:z.string().optional()}).strict().parse(params);
   const file=await this.fs.resolve(p.root,p.path),handle=await open(file,'r');
   try{const s=await handle.stat();if(!s.isFile())throw new Error('只能下载普通文件');const version=`${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`;if(p.version&&p.version!==version)throw new Error('文件已改变，请重新下载');if(p.offset>s.size)throw new Error('无效文件位置');const buffer=Buffer.alloc(Math.min(chunk,s.size-p.offset));const {bytesRead}=await handle.read(buffer,0,buffer.length,p.offset);const after=await handle.stat();if(after.size!==s.size||after.mtimeMs!==s.mtimeMs||after.ctimeMs!==s.ctimeMs)throw new Error('文件已改变，请重新下载');return {data:buffer.subarray(0,bytesRead).toString('base64'),size:s.size,version,next:p.offset+bytesRead,done:p.offset+bytesRead===s.size};}finally{await handle.close();}
  }
  if(method==='files.uploadStart'){
   const p=location.extend({size:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)}).strict().parse(params);
   if(this.uploads.size>=8)throw new Error('上传任务已满');
   const target=await this.fs.resolve(p.root,p.path);if(await lstat(target).then(()=>true,()=>false))throw new Error('目标已存在，请先重命名');
   const id=randomUUID(),temporary=join(dirname(target),`.cagent-${id}.part`);const h=await open(temporary,'wx',0o600);await h.close();
   this.uploads.set(id,{owner,target,temporary,size:p.size,offset:0,expires:Date.now()+20*60_000,busy:false});return {id,chunkSize:chunk};
  }
  const p=z.object({id:z.string().uuid(),offset:z.number().int().nonnegative().optional(),data:z.string().max(Math.ceil(chunk/3)*4).optional()}).strict().parse(params);
  const u=this.uploads.get(p.id);if(!u||u.owner!==owner)throw new Error('上传任务不存在或已过期');if(u.busy)throw new Error('上传任务正在处理');u.busy=true;
  try{
   if(method==='files.uploadCancel'){await unlink(u.temporary);this.uploads.delete(p.id);return {ok:true};}
   if(method==='files.uploadChunk'){
    if(p.offset!==u.offset||p.data===undefined)throw new Error('上传位置不一致');const buffer=Buffer.from(p.data,'base64');if(buffer.toString('base64')!==p.data||!buffer.length||u.offset+buffer.length>u.size)throw new Error('无效上传数据');
    const h=await open(u.temporary,'r+');try{let written=0;while(written<buffer.length){signal.throwIfAborted();const r=await h.write(buffer,written,buffer.length-written,u.offset+written);if(!r.bytesWritten)throw new Error('文件写入未完成');written+=r.bytesWritten;}}finally{await h.close();}
    u.offset+=buffer.length;u.expires=Date.now()+20*60_000;return {next:u.offset};
   }
   if(method==='files.uploadFinish'){if(u.offset!==u.size)throw new Error('上传尚未完成');signal.throwIfAborted();await link(u.temporary,u.target);await unlink(u.temporary);this.uploads.delete(p.id);return {ok:true};}
   throw new Error('不支持的文件操作');
  }finally{u.busy=false;}
 }
}
