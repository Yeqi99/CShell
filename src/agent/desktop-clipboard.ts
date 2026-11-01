import {randomUUID} from 'node:crypto';
import type {NativeDesktop} from './desktop-native';
import type {DesktopClipboardRequest} from '../shared/desktop-clipboard';
/** No Node file IO: the interactive-session user owns native file handles and tokens. */
export class DesktopClipboardTransfer{
 private transfer?:{token:string;kind:string;size:number;offset:number;expires:number;writing:boolean};private busy=false;
 async close(){this.transfer=undefined;}
 async call(capture:NativeDesktop,generation:number,p:DesktopClipboardRequest,authorize:()=>void){
  if(this.busy)throw Error('剪贴板传输正在进行');this.busy=true;
  const native=async(input:Record<string,unknown>)=>{authorize();const value=await capture.clipboard(generation,input);authorize();return value;};
  try{
   if(p.action==='sequence')return native({action:'sequence'});
   if(p.action==='fileBegin'){if(!p.name||p.size===undefined)throw Error('文件信息不完整');return native({action:'fileBegin',name:p.name,size:p.size});}
   if(p.action==='filesCommit'){if(!p.fileTokens?.length)throw Error('请选择文件');return native({action:'filesCommit',fileTokens:p.fileTokens});}
   if(p.action==='fileRead'){if(!p.fileToken||p.offset===undefined)throw Error('文件信息不完整');const chunks:Buffer[]=[];let offset=p.offset,done=false;for(let i=0;i<32&&!done;i++){const r=await native({action:'fileRead',fileToken:p.fileToken,offset});const b=Buffer.from(r.hex,'hex');if(r.offset!==offset+b.length||(!b.length&&!r.done))throw Error('文件返回无效');chunks.push(b);offset=r.offset;done=r.done;}return {data:Buffer.concat(chunks).toString('base64'),offset,done};}
   if(p.action==='fileChunk'){if(!p.fileToken||p.offset===undefined||typeof p.data!=='string')throw Error('文件信息不完整');const data=Buffer.from(p.data,'base64');if(data.length>65536)throw Error('文件分块过大');let offset=p.offset;for(let i=0;i<data.length;i+=2048){const b=data.subarray(i,i+2048);const r=await native({action:'fileChunk',fileToken:p.fileToken,offset,hex:b.toString('hex')});if(r.offset!==offset+b.length)throw Error('文件写入位置不正确');offset=r.offset;}return {offset};}
   if(p.action==='read'){const v=await native({action:'read'});if(v.kind==='files')return v;if(!['text','png','empty'].includes(v.kind))throw Error('剪贴板类型不支持');const token=randomUUID();this.transfer={token,kind:v.kind,size:v.size,offset:0,expires:Date.now()+60000,writing:false};return {token,kind:v.kind,size:v.size};}
   if(p.action==='writeBegin'){if(!p.kind||p.size===undefined||p.size>16*1024*1024)throw Error('剪贴板格式不完整');await native({action:'begin',kind:p.kind,size:p.size});const token=randomUUID();this.transfer={token,kind:p.kind,size:p.size,offset:0,expires:Date.now()+60000,writing:true};return {token,chunkSize:65536};}
   const t=this.transfer;if(!t||p.token!==t.token||t.expires<Date.now())throw Error('剪贴板传输已过期');
   if(p.action==='readChunk'){if(t.writing||p.offset!==t.offset)throw Error('剪贴板位置不正确');const chunks:Buffer[]=[];for(let i=0;i<32&&t.offset<t.size;i++){const r=await native({action:'chunk',offset:t.offset});const b=Buffer.from(r.hex,'hex');if(!b.length||r.offset!==t.offset+b.length||r.offset>t.size)throw Error('剪贴板返回无效');chunks.push(b);t.offset=r.offset;}return {data:Buffer.concat(chunks).toString('base64'),offset:t.offset,done:t.offset===t.size};}
   if(p.action==='writeChunk'){if(!t.writing||p.offset!==t.offset||typeof p.data!=='string')throw Error('剪贴板位置不正确');const data=Buffer.from(p.data,'base64');if(data.length>65536||t.offset+data.length>t.size)throw Error('剪贴板分块过大');for(let i=0;i<data.length;i+=2048){const chunk=data.subarray(i,i+2048);await native({action:'chunk',offset:t.offset,hex:chunk.toString('hex')});t.offset+=chunk.length;}return {offset:t.offset};}
   if(!t.writing||t.offset!==t.size)throw Error('剪贴板传输尚未完成');const result=await native({action:'commit'});this.transfer=undefined;return result;
  }finally{this.busy=false;}
 }
}
