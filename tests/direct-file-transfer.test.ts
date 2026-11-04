import {randomUUID} from 'node:crypto';
import {test} from 'node:test';import assert from 'node:assert/strict';
import {createServer as createNetServer} from 'node:net';import {ClientServer} from '../src/core/client/server';import {ClientVault} from '../src/core/client/identity';import {z} from 'zod';import {mkdtemp,realpath,writeFile,readFile,rm} from 'node:fs/promises';import {join,relative} from 'node:path';import {tmpdir} from 'node:os';
import {AgentFiles} from '../src/agent/files';import {DirectFileTransfer} from '../src/agent/file-transfer';import {createIdentity,fingerprint} from '../src/core/client/identity';
test('direct TLS file ticket binds recipient, verifies destination digest, revokes and rejects replay',{timeout:20000},async()=>{
 let authorized=true;const a=await createIdentity(),b=await createIdentity(),filesA=new AgentFiles(),filesB=new AgentFiles(),source=new DirectFileTransfer(filesA,async()=>a,o=>authorized&&o==='controller'),target=new DirectFileTransfer(filesB,async()=>b,o=>o==='controller');
 const dir=await realpath(await mkdtemp(join(tmpdir(),'direct-file-'))),signal=new AbortController().signal;
 const vault=new ClientVault(join(dir,'vault'),{encrypt:async s=>s,decrypt:async s=>s});await vault.write('identity',a);
 const server=new ClientServer(vault,{id:'fixture',version:'1',capabilities:[],configuration:z.any(),connect:async()=>{throw Error('No terminal');},disconnect(){},resolve(){throw Error('No terminal');}},{fileTransferReset:()=>source.close(),fileTransfer:(raw,recipient,signal)=>source.read(raw,recipient,signal)});
 await server.load();await server.setAccess({password:'isolated-test-password',shells:[],allowManage:true});const listener=createNetServer();await new Promise<void>(r=>listener.listen(0,'127.0.0.1',r));const port=(listener.address() as any).port;await new Promise<void>(r=>listener.close(()=>r()));await server.start({bind:'127.0.0.1',port});
 const locate=async(f:AgentFiles)=>{const result=await f.call('files.roots',{},'controller',signal) as any;const root=result.roots.find((r:any)=>dir.toLowerCase().startsWith(r.label.toLowerCase()));return{root:root.root,path:'/'+relative(root.label,dir).replaceAll('\\','/')};};
 try{const from=await locate(filesA),to=await locate(filesB),bytes=Buffer.alloc(600003,123);await writeFile(join(dir,'source'),bytes);
 const grant=await source.manage('files.transferGrant',{file:{...from,path:from.path+'/source'},recipient:fingerprint(b.certificate)},'controller',signal) as any;
 assert.equal(JSON.stringify(grant).includes(dir),false);
 await assert.rejects(source.read({ticket:grant.ticket,probe:true},fingerprint(a.certificate),signal),/unauthorized/);
 const input={id:randomUUID(),host:'127.0.0.1',port,certificate:a.certificate,ticket:grant.ticket,destination:{...to,path:to.path+'/target'}};
 const result=await target.manage('files.transferPull',input,'controller',signal) as any;assert.equal(result.route,'machine-direct');assert.equal(result.verified,true);assert.deepEqual(await readFile(join(dir,'target')),bytes);
 await assert.rejects(source.read({ticket:grant.ticket,probe:true},fingerprint(b.certificate),signal),/expired/);
 const next=await source.manage('files.transferGrant',{file:{...from,path:from.path+'/source'},recipient:fingerprint(b.certificate)},'controller',signal) as any;
 await assert.rejects(target.manage('files.transferPull',{...input,ticket:next.ticket,certificate:b.certificate},'controller',signal),/identity/);
 await source.manage('files.transferRevoke',{ticket:next.ticket},'controller',signal);await assert.rejects(source.read({ticket:next.ticket,probe:true},fingerprint(b.certificate),signal),/expired/);
 const issue=()=>source.manage('files.transferGrant',{file:{...from,path:from.path+'/source'},recipient:fingerprint(b.certificate)},'controller',signal) as Promise<any>;
 const disconnected=await issue(),connection=new AbortController();await source.read({ticket:disconnected.ticket,offset:0},fingerprint(b.certificate),connection.signal);connection.abort();await assert.rejects(source.read({ticket:disconnected.ticket,offset:65536},fingerprint(b.certificate),signal),/expired/);
 const changed=await issue();await writeFile(join(dir,'source'),Buffer.from('changed'));await assert.rejects(source.read({ticket:changed.ticket,offset:0},fingerprint(b.certificate),signal),/改变/);
 const revoked=await issue();authorized=false;await assert.rejects(source.read({ticket:revoked.ticket,offset:0},fingerprint(b.certificate),signal),/unauthorized/);authorized=true;
 await assert.rejects(source.manage('files.transferGrant',{file:{root:randomUUID(),path:'/source'},recipient:fingerprint(b.certificate)},'controller',signal),/expired/);
 const stopped=await issue();await server.stop();await assert.rejects(source.read({ticket:stopped.ticket,probe:true},fingerprint(b.certificate),signal),/expired/);

 }finally{await server.stop();source.close();target.close();await filesA.close();await filesB.close();await rm(dir,{recursive:true,force:true});}
});
