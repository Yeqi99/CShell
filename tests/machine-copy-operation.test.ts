import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {join,relative} from 'node:path';
import {tmpdir} from 'node:os';
import {AgentFiles} from '../src/agent/files';
import {copyMachineOperation} from '../src/core/machine-copy-operation';

test('real directory copy preserves nesting, rejects overwrite, and checks revocation before commit',async()=>{
 const a=new AgentFiles(),b=new AgentFiles(),dir=await realpath(await mkdtemp(join(tmpdir(),'copy-tree-'))),signal=new AbortController().signal;
 const factory=(service:AgentFiles)=>async(s:AbortSignal)=>({call:(method:string,p:unknown,abort=s)=>service.call(method,p,'controller',abort),dispose:async()=>{}});
 try{
  const locate=async(service:AgentFiles)=>{const {roots}=await service.call('files.roots',{},'controller',signal) as {roots:{root:string;label:string}[]};const root=roots.find(r=>dir.toLowerCase().startsWith(r.label.toLowerCase()));assert(root);return{root:root.root,path:'/'+relative(root.label,dir).replaceAll('\\','/')};};
  const from=await locate(a),to=await locate(b);await mkdir(join(dir,'source','nested'),{recursive:true});await writeFile(join(dir,'source','nested','large.bin'),Buffer.alloc(180000,13));await writeFile(join(dir,'source','empty.txt'),'');
  const events:unknown[]=[];
  const result=await copyMachineOperation(factory(a),{...from,path:from.path+'/source'},factory(b),{...to,path:to.path+'/copied'},true,signal,()=>{},e=>events.push(e));
  assert.equal(result.completed,2);assert.equal(result.bytes,180000);assert.deepEqual(await readFile(join(dir,'copied','nested','large.bin')),Buffer.alloc(180000,13));assert(events.length>1);
  await assert.rejects(copyMachineOperation(factory(a),{...from,path:from.path+'/source'},factory(b),{...to,path:to.path+'/copied'},true,signal,()=>{},()=>{}));
  let permitted=true;
  await assert.rejects(copyMachineOperation(factory(a),{...from,path:from.path+'/source/nested/large.bin'},factory(b),{...to,path:to.path+'/revoked.bin'},false,signal,()=>{if(!permitted)throw Error('revoked');},()=>{permitted=false;}),/revoked/);
  assert(!(await readdir(dir)).some(n=>n.includes('revoked')||n.endsWith('.part')));
 }finally{await a.close();await b.close();await rm(dir,{recursive:true,force:true});}
});

test('tree preflight refuses links and traversal before destination mutation',async()=>{
 for(const row of [{name:'escape',symlink:true},{name:'../escape',symlink:false}]){
  let writes=0;
  const source=async()=>({call:async()=>({entries:[{...row,directory:false,size:1}]}),dispose:async()=>{}});
  const destination=async()=>({call:async()=>{writes++;return{};},dispose:async()=>{}});
  await assert.rejects(copyMachineOperation(source,{root:'a',path:'/src'},destination,{root:'b',path:'/dst'},true,new AbortController().signal,()=>{},()=>{}));assert.equal(writes,0);
 }
});
