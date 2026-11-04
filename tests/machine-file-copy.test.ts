import {test} from 'node:test';
import assert from 'node:assert/strict';
import {copyMachineFile} from '../src/core/machine-file-copy';
import {AgentFiles} from '../src/agent/files';
import {mkdtemp,realpath,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,relative} from 'node:path';
test('machine copy streams negotiated chunks and never commits a changed source',async()=>{
 const ref={root:'root',path:'/file'},calls:string[]=[],written:Buffer[]=[];
 const target=async(method:string,p:any)=>{calls.push(method);if(method==='files.uploadStart')return {id:'upload',chunkSize:2};if(method==='files.uploadChunk'){written.push(Buffer.from(p.data,'base64'));return {next:p.offset+Buffer.from(p.data,'base64').length};}return {ok:true};};
 const source=async()=>({data:Buffer.from('hello').toString('base64'),size:5,version:'v1',next:5,done:true});
 const result=await copyMachineFile(source,ref,target,ref,new AbortController().signal,()=>{});
 assert.equal(Buffer.concat(written).toString(),'hello');assert.equal(result.bytes,5);assert.equal(calls.filter(x=>x==='files.uploadChunk').length,3);assert.equal(calls.at(-1),'files.uploadFinish');
 calls.length=0;let reads=0;
 const changing=async()=>++reads===1?{data:'YQ==',size:2,version:'v1',next:1,done:false}:{data:'Yg==',size:2,version:'v2',next:2,done:true};
 await assert.rejects(copyMachineFile(changing,ref,target,ref,new AbortController().signal,()=>{}),/changed/);
 assert.equal(calls.at(-1),'files.uploadCancel');assert.ok(!calls.includes('files.uploadFinish'));
});
test('independent file services copy real bytes and cancel without leaving destination or temporary files',async()=>{
 const a=new AgentFiles(),b=new AgentFiles(),dir=await realpath(await mkdtemp(join(tmpdir(),'machine-copy-'))),signal=new AbortController().signal;
 const bind=(service:AgentFiles)=>(method:string,params:unknown,s=signal)=>service.call(method,params,'verified-controller',s);
 try{
  const source=bind(a),target=bind(b);
  const locate=async(call:ReturnType<typeof bind>)=>{const result=await call('files.roots',{}) as {roots:{root:string;label:string}[]};const root=result.roots.find(r=>dir.toLowerCase().startsWith(r.label.toLowerCase()));assert.ok(root);return {root:root.root,path:'/'+relative(root.label,dir).replaceAll('\\','/')};};
  const from=await locate(source),to=await locate(target),bytes=Buffer.alloc(190000,37);await writeFile(join(dir,'source.bin'),bytes);
  await copyMachineFile(source,{...from,path:from.path+'/source.bin'},target,{...to,path:to.path+'/target.bin'},signal,()=>{});
  assert.deepEqual(await readFile(join(dir,'target.bin')),bytes);
  await assert.rejects(copyMachineFile(source,{...from,path:from.path+'/source.bin'},target,{...to,path:to.path+'/target.bin'},signal,()=>{}),/已存在/);
  const controller=new AbortController();
  await assert.rejects(copyMachineFile(source,{...from,path:from.path+'/source.bin'},target,{...to,path:to.path+'/cancel.bin'},controller.signal,()=>controller.abort()));
  assert.deepEqual((await readdir(dir)).sort(),['source.bin','target.bin']);
 }finally{await a.close();await b.close();await rm(dir,{recursive:true,force:true});}
});
