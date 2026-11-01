import type {Bridge} from '../shared/contracts';
const encode=(bytes:Uint8Array)=>{let text='';for(const byte of bytes)text+=String.fromCharCode(byte);return btoa(text);};
const decode=(text:string)=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));
export async function pushDesktopClipboard(bridge:Bridge,id:string,generation:number|undefined,valid:()=>boolean){
 const check=()=>{if(!valid())throw Error('连接或权限已变化，剪贴板传输已停止');};check();
 const value=await bridge.localClipboardRead();check();
 if(value.kind==='empty')return false;
 if(value.kind==='files'){
  const tokens:string[]=[];
  for(const file of value.files){check();const begin=await bridge.desktopViewClipboard(id,{action:'fileBegin',name:file.name,size:file.size},generation);tokens.push(begin.fileToken);
   for(let offset=0;offset<file.size;){check();const data=await bridge.localClipboardFileRead(file.token,offset,65536);const size=decode(data).length;if(!size||offset+size>file.size)throw Error('本机剪贴板文件已变化');check();await bridge.desktopViewClipboard(id,{action:'fileChunk',fileToken:begin.fileToken,offset,data},generation);offset+=size;}
  }check();await bridge.desktopViewClipboard(id,{action:'filesCommit',fileTokens:tokens},generation);return true;
 }
 const bytes=value.kind==='text'?new TextEncoder().encode(value.text):decode(value.data);
 const begin=await bridge.desktopViewClipboard(id,{action:'writeBegin',kind:value.kind,size:bytes.length},generation);
 for(let offset=0;offset<bytes.length;offset+=65536){check();await bridge.desktopViewClipboard(id,{action:'writeChunk',token:begin.token,offset,data:encode(bytes.subarray(offset,offset+65536))},generation);}
 check();await bridge.desktopViewClipboard(id,{action:'writeCommit',token:begin.token},generation);return true;
}
export async function pullDesktopClipboard(bridge:Bridge,id:string,generation:number|undefined,valid:()=>boolean){
 const check=()=>{if(!valid())throw Error('连接或权限已变化，剪贴板传输已停止');};check();
 const value=await bridge.desktopViewClipboard(id,{action:'read'},generation);check();
 if(value.kind==='empty')return;
 if(value.kind==='files'){
  const staging=await bridge.localClipboardFilesBegin(value.files.map((f:any)=>({name:f.name,size:f.size})));
  for(let index=0;index<value.files.length;index++){const file=value.files[index];for(let offset=0;offset<file.size;){check();const chunk=await bridge.desktopViewClipboard(id,{action:'fileRead',fileToken:file.token,offset},generation);const size=decode(chunk.data).length;if(!size||offset+size>file.size)throw Error('远端剪贴板文件已变化');check();await bridge.localClipboardFilesChunk(staging,index,offset,chunk.data);offset+=size;}}
  check();await bridge.localClipboardFilesCommit(staging);return;
 }
 if(!['text','png'].includes(value.kind)||!Number.isSafeInteger(value.size)||value.size<0||value.size>16*1024*1024)throw Error('不支持的远端剪贴板内容');
 const bytes=new Uint8Array(value.size);let offset=0;
 while(offset<bytes.length){check();const chunk=await bridge.desktopViewClipboard(id,{action:'readChunk',token:value.token,offset},generation);const data=decode(chunk.data);if(!data.length||offset+data.length>bytes.length)throw Error('剪贴板传输数据不完整');bytes.set(data,offset);offset+=data.length;}
 check();await bridge.localClipboardWrite(value.kind==='text'?{kind:'text',text:new TextDecoder('utf-8',{fatal:true}).decode(bytes)}:{kind:'png',data:encode(bytes)});
}
