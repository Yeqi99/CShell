import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,realpath,mkdir,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,relative} from 'node:path';
import {AgentFiles} from '../src/agent/files';

test('machine files: chunked transfer, identity isolation, no overwrite, changes and cleanup',async()=>{
 // macOS tmpdir may use /var, a symlink to /private/var. Build root-relative
 // fixture paths from the canonical directory, just as the file picker does.
 const service=new AgentFiles(),dir=await realpath(await mkdtemp(join(tmpdir(),'agent-files-')));const signal=new AbortController().signal;
 const call=(m:string,p?:unknown,owner='test')=>service.call('files.'+m,p,owner,signal) as Promise<any>;
 try{
  const {roots}=await call('roots');const drive=roots.find((r:any)=>dir.toLowerCase().startsWith(r.label.toLowerCase()));assert.ok(drive);
  const base='/'+relative(drive.label,dir).replaceAll('\\','/'),root=drive.root,path=base+'/payload.bin';const bytes=Buffer.alloc(600000,123);
  const {id,chunkSize}=await call('uploadStart',{root,path,size:bytes.length});
  assert.ok(Buffer.byteLength(JSON.stringify({method:'files.uploadChunk',params:{id,offset:0,data:Buffer.alloc(chunkSize).toString('base64')}}))<128*1024);
  assert.ok(chunkSize<=65536);
  await assert.rejects(call('uploadChunk',{id,offset:0,data:'YQ=='},'other'),/不存在/);
  await assert.rejects(call('uploadChunk',{id,offset:5,data:'YQ=='}),/位置/);
  for(let offset=0;offset<bytes.length;offset+=chunkSize)await call('uploadChunk',{id,offset,data:bytes.subarray(offset,offset+chunkSize).toString('base64')});
  await call('uploadFinish',{id});assert.deepEqual(await readFile(join(dir,'payload.bin')),bytes);
  await assert.rejects(call('uploadStart',{root,path,size:1}),/已存在/);
  const parts:Buffer[]=[];let offset=0,version:string|undefined;for(;;){const r=await call('read',{root,path,offset,version});parts.push(Buffer.from(r.data,'base64'));offset=r.next;version=r.version;if(r.done)break;}assert.deepEqual(Buffer.concat(parts),bytes);
  await writeFile(join(dir,'payload.bin'),'changed');await assert.rejects(call('read',{root,path,offset:0,version}),/改变/);
  await call('action',{root,path:base+'/folder',action:'mkdir'});await call('action',{root,path,action:'rename',destination:base+'/renamed.bin'});
  const listing=await call('list',{root,path:base});assert.equal(listing.entries.length,2);
  await call('action',{root,path:base+'/renamed.bin',action:'delete'});
  const cancel=await call('uploadStart',{root,path:base+'/cancel.bin',size:1});await call('uploadCancel',{id:cancel.id});assert.equal((await call('list',{root,path:base})).entries.length,1);
  await assert.rejects(call('action',{root,path:'/',action:'delete'}),/root/);
  await assert.rejects(call('read',{root,path:base+'/../NUL',offset:0}),/Unsafe/);
  await mkdir(join(dir,'actual'));
  await symlink(join(dir,'actual'),join(dir,'alias'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(call('uploadStart',{root,path:base+'/alias/blocked.bin',size:1}),/Symbolic links and junctions/);
 }finally{await service.close();await rm(dir,{recursive:true,force:true});}
});
