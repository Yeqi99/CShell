import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,stat,readdir,rm} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import type {CloudEnvelope,CloudRevision} from '../shared/cloud-sync';
const CHUNK=1024*1024,MAX=256*1024*1024;
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
type Request=(body?:unknown)=>Promise<any>;
/** Wire buffers are <=1MiB. Ciphertext download parts are resumable on disk. */
export async function chunkVault(request:Request,cache:string,body?:{baseRevision:number;mutationId:string;envelope:CloudEnvelope}):Promise<CloudRevision|{revision:number}>{
 let manifest:any;try{manifest=await request();}catch(error){if((error as {status?:number}).status===404)Object.assign(error as object,{unsupportedChunkTransport:true});throw error;}
 if(manifest.transport!==1||manifest.chunkSize!==CHUNK)throw Error('云服务分块协议不兼容，请更新客户端');
 if(body){
  const text=body.envelope.ciphertext;
  if(text.length>Math.ceil((MAX+16)/3)*4)throw Error('同步数据超过本设备容量');
  const state=await request({action:'begin',baseRevision:body.baseRevision,mutationId:body.mutationId,nonce:body.envelope.nonce,length:text.length,digest:hash(text)});
  if(state.committed)return {revision:state.revision};
  if(!Array.isArray(state.received)||state.received.length>350)throw Error('分块状态无效');
  const received=new Set(state.received);
  for(let part=0;part<Math.ceil(text.length/CHUNK);part++){if(received.has(part))continue;const data=text.slice(part*CHUNK,(part+1)*CHUNK);await request({action:'put',mutationId:body.mutationId,part,data,digest:hash(data)});}
  return request({action:'commit',mutationId:body.mutationId});
 }
 if(manifest.revision===0&&manifest.envelope===null)return {revision:0,envelope:null};
 if(!Number.isSafeInteger(manifest.revision)||manifest.revision<1||!Number.isSafeInteger(manifest.length)||manifest.length<24||manifest.length>Math.ceil((MAX+16)/3)*4||typeof manifest.nonce!=='string')throw Error('云端分块清单无效');
 const directory=join(cache,String(manifest.revision));await mkdir(directory,{recursive:true});
 for(const name of await readdir(cache)){if(!/^\d+$/.test(name)||name===String(manifest.revision))continue;const target=resolve(cache,name);if(target.startsWith(resolve(cache)+sep))await rm(target,{recursive:true,force:true});}
 const parts:string[]=[];const full=createHash('sha256');
 for(let part=0;part<Math.ceil(manifest.length/CHUNK);part++){
  const path=join(directory,String(part)+'.json');let value:{data:string;digest:string}|undefined;
  try{if((await stat(path)).size>CHUNK+256)throw Error('cache size');value=JSON.parse(await readFile(path,'utf8'));}catch{}
  const valid=(v:typeof value)=>v&&typeof v.data==='string'&&v.data.length===Math.min(CHUNK,manifest.length-part*CHUNK)&&v.digest===hash(v.data);
  if(!valid(value)){value=await request({action:'get',revision:manifest.revision,part});if(!valid(value))throw Error('云端分块摘要不匹配');await writeFile(path,JSON.stringify(value),{mode:0o600});}
  parts.push(value!.data);full.update(value!.data);
 }
 if(manifest.digest&&full.digest('hex')!==manifest.digest)throw Error('云端密文摘要不匹配');
 return {revision:manifest.revision,envelope:{format:1,nonce:manifest.nonce,ciphertext:parts.join('')}};
}
