import {z} from 'zod';
import {posix} from 'node:path';
import {copyMachineFile,type MachineFile} from './machine-file-copy';

export type CopyEndpoint={call:(method:string,input:unknown,signal?:AbortSignal)=>Promise<unknown>;dispose:()=>Promise<void>};
export type CopyEndpointFactory=(signal:AbortSignal)=>Promise<CopyEndpoint>;
const entry=z.object({name:z.string().min(1).max(255),directory:z.boolean(),symlink:z.boolean(),size:z.number().nonnegative()});
/** Preflight the complete bounded tree before the first write. No following links,
 * overwrites, credentials or transfer tickets. Completed files remain on failure. */
export async function copyMachineOperation(source:CopyEndpointFactory,from:MachineFile,destination:CopyEndpointFactory,to:MachineFile,directory:boolean,signal:AbortSignal,guard:()=>void,progress:(event:unknown)=>void){
 const files:{relative:string;size:number}[]=[],directories:string[]=[];let total=0;
 if(directory){
  const endpoint=await source(signal);
  try{const pending=[{relative:'',depth:0}];while(pending.length){signal.throwIfAborted();guard();const item=pending.shift()!;if(item.depth>32)throw Error('Directory exceeds depth limit (32)');directories.push(item.relative);
   const result=z.object({entries:z.array(entry).max(10000)}).parse(await endpoint.call('files.list',{root:from.root,path:posix.join(from.path,item.relative)},signal));
   for(const row of result.entries){if(row.symlink)throw Error('Symbolic links are not copied');if(row.name==='.'||row.name==='..'||/[\\/\x00]/.test(row.name))throw Error('Invalid directory entry');const relative=posix.join(item.relative,row.name);if(relative.length>3000)throw Error('Directory path too long');if(row.directory)pending.push({relative,depth:item.depth+1});else{files.push({relative,size:row.size});total+=row.size;}if(files.length+directories.length+pending.length>10000)throw Error('Directory exceeds entry limit (10000)');}
  }}finally{await endpoint.dispose();}
 }else files.push({relative:'',size:0});
 let completed=0,bytes=0;
 try{
  if(directory){const endpoint=await destination(signal);try{for(const relative of directories){signal.throwIfAborted();guard();await endpoint.call('files.action',{root:to.root,path:posix.join(to.path,relative),action:'mkdir'},signal);}}finally{await endpoint.dispose();}}
  for(const file of files){signal.throwIfAborted();guard();const a=await source(signal);let b:CopyEndpoint|undefined;
   try{b=await destination(signal);const bound=(e:CopyEndpoint)=>(method:string,input:unknown,s?:AbortSignal)=>{guard();return e.call(method,input,s);};const result=await copyMachineFile(bound(a),{root:from.root,path:posix.join(from.path,file.relative)},bound(b),{root:to.root,path:posix.join(to.path,file.relative)},signal,(done,size)=>progress({completed,files:files.length,bytes:bytes+done,total:directory?total:size}));bytes+=result.bytes;completed++;}
   finally{await a.dispose();await b?.dispose();}
  }
  return {completed,bytes,route:'controller-stream',directory};
 }catch(error){progress({completed,bytes,partial:true});throw error;}
}
