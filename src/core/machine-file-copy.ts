import {z} from 'zod';
import {createHash} from 'node:crypto';

type Call=(method:string,params:unknown,signal?:AbortSignal)=>Promise<unknown>;
export type MachineFile={root:string;path:string};
const chunkSchema=z.object({data:z.string().max(349528),size:z.number().int().nonnegative(),version:z.string().min(1),next:z.number().int().nonnegative(),done:z.boolean()});

/** Bounded streaming fallback through the controller. Both calls must already be
 * bound to authenticated targets; this function never selects another route. */
export async function copyMachineFile(source:Call,from:MachineFile,target:Call,to:MachineFile,signal:AbortSignal,progress:(done:number,total:number)=>void){
 let upload='',offset=0,writeSize=65536,version:string|undefined,size:number|undefined;
 const hash=createHash('sha256');
 try{
  for(;;){
   signal.throwIfAborted();
   const part=chunkSchema.parse(await source('files.read',{...from,offset,version},signal));
   const bytes=Buffer.from(part.data,'base64');
   if(bytes.toString('base64')!==part.data||part.next!==offset+bytes.length||(!part.done&&!bytes.length)||part.next>part.size)throw Error('Invalid source file chunk');
   if(size!==undefined&&(size!==part.size||version!==part.version))throw Error('Source file changed during transfer');
   size=part.size;version=part.version;
   if(!upload){
    const start=z.object({id:z.string().min(1),chunkSize:z.number().int().min(1).max(262144)}).parse(await target('files.uploadStart',{...to,size},signal));
    upload=start.id;
    // Retain the negotiated maximum for subsequent writes.
    writeSize=start.chunkSize;
   }
   for(let at=0;at<bytes.length;at+=writeSize){
    signal.throwIfAborted();const data=bytes.subarray(at,at+writeSize);
    const result=z.object({next:z.number().int().nonnegative()}).parse(await target('files.uploadChunk',{id:upload,offset:offset+at,data:data.toString('base64')},signal));
    if(result.next!==offset+at+data.length)throw Error('Invalid destination file offset');
   }
   hash.update(bytes);offset=part.next;progress(offset,size);
   if(part.done){if(offset!==size)throw Error('Incomplete source file');break;}
  }
  signal.throwIfAborted();await target('files.uploadFinish',{id:upload},signal);upload='';
  return {bytes:offset,sha256:hash.digest('hex'),route:'controller-stream' as const};
 }finally{if(upload)await target('files.uploadCancel',{id:upload},AbortSignal.timeout(5000)).catch(()=>{});}
}
