import {randomUUID} from 'node:crypto';
import {mkdir,stat,open,writeFile,appendFile} from 'node:fs/promises';
import {basename,join,isAbsolute} from 'node:path';
import type {LocalClipboardContent} from '../shared/local-clipboard';
export function decodeDropFiles(data:Buffer):string[]{
 if(data.length<22)return [];const offset=data.readUInt32LE(0);
 if(offset<20||offset>=data.length||data.readUInt32LE(16)!==1)return [];
 return data.subarray(offset).toString('utf16le').split('\0').filter(Boolean).filter(isAbsolute).slice(0,64);
}
export function encodeDropFiles(paths:string[]):Buffer{
 const header=Buffer.alloc(20);header.writeUInt32LE(20,0);header.writeUInt32LE(1,16);
 return Buffer.concat([header,Buffer.from(paths.join('\0')+'\0\0','utf16le')]);
}
type Adapter={text():string|Promise<string>;png():Buffer|Promise<Buffer>;files():Buffer|Promise<Buffer>;writeText(text:string):void|Promise<void>;writePng(data:Buffer):void|Promise<void>;writeFiles(data:Buffer):void|Promise<void>};
/** No polling: every read is requested from an explicit copy/paste gesture. */
export class LocalClipboard {
 private sources=new Map<string,{path:string;size:number;mtime:number;until:number}>();
 private uploads=new Map<string,{files:{path:string;size:number;received:number;busy?:boolean}[];until:number}>();
 constructor(private adapter:Adapter,private cache:string,private windows=process.platform==='win32'){}
 async read():Promise<LocalClipboardContent>{
  for(const [key,value] of this.sources)if(value.until<Date.now())this.sources.delete(key);
  if(this.sources.size>448)throw Error('剪贴板文件引用过多，请稍后再试');
  if(this.windows){const paths=decodeDropFiles(await this.adapter.files());if(paths.length){const files=[];for(const path of paths){const info=await stat(path);if(!info.isFile())throw Error('文件夹请使用文件窗口传输');if(info.size>512*1024*1024)throw Error('单个剪贴板文件不能超过512 MB');const token=randomUUID();this.sources.set(token,{path,size:info.size,mtime:info.mtimeMs,until:Date.now()+10*60_000});files.push({token,name:basename(path),size:info.size});}return {kind:'files',files};}}
  const png=await this.adapter.png();if(png.length){if(png.length>16*1024*1024)throw Error('剪贴板图片超过16 MB');return {kind:'png',data:png.toString('base64')};}
  const text=await this.adapter.text();if(text.length>2_000_000)throw Error('剪贴板文本超过2 MB');return text?{kind:'text',text}:{kind:'empty'};
 }
 write(value:{kind:'text';text:string}|{kind:'png';data:string}){
  if(!value||typeof value!=='object')throw Error('无效剪贴板数据');
  if(value.kind==='text'){if(typeof value.text!=='string'||value.text.length>2_000_000)throw Error('无效剪贴板文本');return this.adapter.writeText(value.text);}
  if(value.kind!=='png'||typeof value.data!=='string'||value.data.length>24*1024*1024)throw Error('无效剪贴板图片');const png=Buffer.from(value.data,'base64');if(png.length>16*1024*1024||!png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('无效PNG图片');return this.adapter.writePng(png);
 }
 async fileRead(token:string,offset:number,length:number){
  const source=this.sources.get(token);if(!source||source.until<Date.now())throw Error('剪贴板文件引用已过期，请重新复制');
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(length)||length<1||length>262144||offset>source.size)throw Error('无效文件读取范围');
  const info=await stat(source.path);if(info.size!==source.size||info.mtimeMs!==source.mtime)throw Error('复制后文件已变化，请重新复制');
  const handle=await open(source.path,'r');try{const data=Buffer.alloc(Math.min(length,source.size-offset));const {bytesRead}=await handle.read(data,0,data.length,offset);return data.subarray(0,bytesRead).toString('base64');}finally{await handle.close();}
 }
 async begin(files:{name:string;size:number}[]){
  if(!this.windows)throw Error('此平台尚不支持文件剪贴板');
  for(const [id,value] of this.uploads)if(value.until<Date.now())this.uploads.delete(id);
  if(this.uploads.size>=4||!Array.isArray(files)||!files.length||files.length>64)throw Error('剪贴板文件任务过多');
  const seen=new Set<string>();let total=0;
  for(const f of files){if(!f||typeof f.name!=='string'||!f.name||f.name.length>180||/[\\/:*?"<>|\x00-\x1f]/.test(f.name)||/[. ]$/.test(f.name)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(f.name)||seen.has(f.name.toLowerCase())||!Number.isSafeInteger(f.size)||f.size<0)throw Error('无效剪贴板文件名称或大小');seen.add(f.name.toLowerCase());total+=f.size;}
  if(total>512*1024*1024)throw Error('剪贴板文件总量超过512 MB');
  const id=randomUUID(),dir=join(this.cache,id);await mkdir(dir,{recursive:true});const entries=[];for(const f of files){const path=join(dir,f.name);await writeFile(path,Buffer.alloc(0),{flag:'wx'});entries.push({path,size:f.size,received:0});}this.uploads.set(id,{files:entries,until:Date.now()+30*60_000});return id;
 }
 async chunk(id:string,index:number,offset:number,data:string){const upload=this.uploads.get(id),file=upload?.files[index];if(!upload||upload.until<Date.now()||!file||file.busy||offset!==file.received||typeof data!=='string'||data.length>350000)throw Error('无效剪贴板文件分块');const bytes=Buffer.from(data,'base64');if(!bytes.length||bytes.length>262144||offset+bytes.length>file.size)throw Error('剪贴板文件分块超限');file.busy=true;try{await appendFile(file.path,bytes);file.received+=bytes.length;}catch(error){this.uploads.delete(id);throw error;}finally{file.busy=false;}}
 async commit(id:string){const upload=this.uploads.get(id);if(!upload||upload.until<Date.now()||upload.files.some(f=>f.busy||f.received!==f.size))throw Error('文件尚未传输完整');await this.adapter.writeFiles(encodeDropFiles(upload.files.map(f=>f.path)));this.uploads.delete(id);}
}
