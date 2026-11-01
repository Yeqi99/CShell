import {mkdtemp,mkdir,open,lstat,rm} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import type {NativeDesktop} from './desktop-native';
import type {DesktopClipboardRequest} from '../shared/desktop-clipboard';
/** Single ordered transfer per real desktop session; no renderer-selected native paths. */
export class DesktopClipboardTransfer{
 private files=new Map<string,{path:string;size:number;version:string;offset:number;writing:boolean}>();private directory?:string;private total=0;
 async close(){this.files.clear();if(this.directory){const path=this.directory;this.directory=undefined;await rm(path,{recursive:true,force:true});}}
 private version(s:{size:number;mtimeMs:number;ctimeMs:number}){return `${s.size}:${s.mtimeMs}:${s.ctimeMs}`;}
 private transfer?:{token:string;kind:string;size:number;offset:number;expires:number;writing:boolean};private busy=false;
 async call(capture:NativeDesktop,generation:number,p:DesktopClipboardRequest,authorize:()=>void){
  if(this.busy)throw Error('剪贴板传输正在进行');this.busy=true;
  const native=async(input:Record<string,unknown>)=>{authorize();return capture.clipboard(generation,input);};
  try{
   if(p.action==='fileBegin'){if(!p.name||p.size===undefined||this.files.size>=64||this.total+p.size>512*1024*1024||p.name!==basename(p.name)||/[\\/:*?"<>|\x00-\x1f]/.test(p.name)||/[. ]$/.test(p.name))throw Error('文件名称或大小不正确');this.directory??=await mkdtemp(join(tmpdir(),'cagent-clipboard-'));const token=randomUUID(),folder=join(this.directory,token);await mkdir(folder);const path=join(folder,p.name);const h=await open(path,'wx',0o600);await h.close();this.files.set(token,{path,size:p.size,version:'',offset:0,writing:true});this.total+=p.size;return {fileToken:token,chunkSize:65536};}
   if(p.action==='fileRead'||p.action==='fileChunk'){
    const f=this.files.get(p.fileToken??'');if(!f||p.offset===undefined||p.offset<0||p.offset>f.size)throw Error('剪贴板文件已失效');authorize();const h=await open(f.path,p.action==='fileRead'?'r':'r+');try{
     const before=await h.stat();if(!before.isFile())throw Error('只支持普通文件');
     if(p.action==='fileRead'){if(f.writing||this.version(before)!==f.version)throw Error('剪贴板文件已改变');const b=Buffer.alloc(Math.min(65536,f.size-p.offset));const {bytesRead}=await h.read(b,0,b.length,p.offset);authorize();if(this.version(await h.stat())!==f.version)throw Error('剪贴板文件已改变');return {data:b.subarray(0,bytesRead).toString('base64'),offset:p.offset+bytesRead,done:p.offset+bytesRead===f.size};}
     if(!f.writing||p.offset!==f.offset||typeof p.data!=='string')throw Error('上传位置不正确');const b=Buffer.from(p.data,'base64');if(b.length>65536||f.offset+b.length>f.size)throw Error('上传分块过大');let written=0;while(written<b.length){const r=await h.write(b,written,b.length-written,f.offset+written);if(!r.bytesWritten)throw Error('写入未完成');written+=r.bytesWritten;}f.offset+=written;return {offset:f.offset};
    }finally{await h.close();}
   }
   if(p.action==='filesCommit'){if(!p.fileTokens?.length)throw Error('请选择文件');const paths=p.fileTokens.map(t=>{const f=this.files.get(t);if(!f||!f.writing||f.offset!==f.size)throw Error('文件上传未完成');return f.path;});const b=Buffer.from(JSON.stringify(paths));await native({action:'begin',kind:'files',size:b.length});for(let offset=0;offset<b.length;offset+=2048)await native({action:'chunk',offset,hex:b.subarray(offset,offset+2048).toString('hex')});return native({action:'commit'});}
   if(p.action==='read'){const v=await native({action:'read'});if(v.kind==='files'){if(v.size>65536)throw Error('文件列表过大');const pieces:Buffer[]=[];for(let offset=0;offset<v.size;){const r=await native({action:'chunk',offset});const b=Buffer.from(r.hex,'hex');if(!b.length||r.offset!==offset+b.length)throw Error('文件列表无效');pieces.push(b);offset=r.offset;}const paths=JSON.parse(Buffer.concat(pieces).toString());if(!Array.isArray(paths)||paths.length>64)throw Error('文件数量过多');const result=[];for(const path of paths){if(typeof path!=='string'||this.files.size>=64)throw Error('文件列表无效或传输数量已满');const s=await lstat(path);if(!s.isFile()||s.isSymbolicLink()||this.total+s.size>512*1024*1024)throw Error('只支持512MB以内的普通文件');const token=randomUUID();this.files.set(token,{path,size:s.size,version:this.version(s),offset:0,writing:false});this.total+=s.size;result.push({token,name:basename(path),size:s.size});}return {kind:'files',files:result};}if(!['text','png','empty'].includes(v.kind))throw Error('剪贴板类型不支持');const token=randomUUID();this.transfer={token,kind:v.kind,size:v.size,offset:0,expires:Date.now()+60000,writing:false};return {token,kind:v.kind,size:v.size};}
   if(p.action==='writeBegin'){if(!p.kind||p.size===undefined||p.size>16*1024*1024)throw Error('剪贴板格式不完整');await native({action:'begin',kind:p.kind,size:p.size});const token=randomUUID();this.transfer={token,kind:p.kind,size:p.size,offset:0,expires:Date.now()+60000,writing:true};return {token,chunkSize:65536};}
   const t=this.transfer;if(!t||p.token!==t.token||t.expires<Date.now())throw Error('剪贴板传输已过期');
   if(p.action==='readChunk'){if(t.writing||p.offset!==t.offset)throw Error('剪贴板位置不正确');const chunks:Buffer[]=[];for(let i=0;i<32&&t.offset<t.size;i++){const r=await native({action:'chunk',offset:t.offset});const b=Buffer.from(r.hex,'hex');if(!b.length||r.offset!==t.offset+b.length||r.offset>t.size)throw Error('剪贴板返回无效');chunks.push(b);t.offset=r.offset;}return {data:Buffer.concat(chunks).toString('base64'),offset:t.offset,done:t.offset===t.size};}
   if(p.action==='writeChunk'){if(!t.writing||p.offset!==t.offset||typeof p.data!=='string')throw Error('剪贴板位置不正确');const data=Buffer.from(p.data,'base64');if(data.length>65536||t.offset+data.length>t.size)throw Error('剪贴板分块过大');for(let i=0;i<data.length;i+=2048){const chunk=data.subarray(i,i+2048);await native({action:'chunk',offset:t.offset,hex:chunk.toString('hex')});t.offset+=chunk.length;}return {offset:t.offset};}
   if(!t.writing||t.offset!==t.size)throw Error('剪贴板传输尚未完成');const result=await native({action:'commit'});this.transfer=undefined;return result;
  }finally{this.busy=false;}
 }
}
