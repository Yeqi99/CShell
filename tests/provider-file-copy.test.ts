import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {FtpService} from '../src/core/ftp';
import {providerFileCall} from '../src/core/provider-file-call';
import {copyMachineFile} from '../src/core/machine-file-copy';
import {ftpFixture} from './helpers/ftp-server';
import {fixture} from './fixture';
import {SshService} from '../src/core/ssh';
import {profileSchema} from '../src/shared/contracts';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
test('real SFTP to FTP and FTP to SFTP binary streaming',{timeout:30000},async()=>{
 const remote=await fixture(),server=await ftpFixture(),ssh=new SshService(()=>{},async()=>true),ftp=new FtpService(()=>{});
 try{const {sessionId:id}=await ssh.connect(profileSchema.parse({id:randomUUID(),name:'stream',protocol:'sftp',host:'127.0.0.1',port:remote.port,username:'tester',group:'',favorite:false,auth:'password'}),{password:remote.password});const {sessionId}=await ftp.connect({id:randomUUID(),protocol:'ftp',host:'127.0.0.1',port:server.port,username:'fixture'},{password:'fixture'});const data=Buffer.alloc(300003,91);await writeFile(join(remote.root,'payload'),data);
 const run=async(reverse:boolean)=>{const signal=new AbortController().signal,a=providerFileCall({sftp:await ssh.sftp(id),sessionId:id},signal),b=providerFileCall({ftp,sessionId},signal);try{await copyMachineFile((reverse?b:a).call,{root:'',path:reverse?'/copy':'/payload'},(reverse?a:b).call,{root:'',path:reverse?'/returned':'/copy'},signal,()=>{});}finally{await Promise.all([a.dispose(),b.dispose()]);}};
 await run(false);assert.deepEqual(server.files.get('/copy'),data);await run(true);assert.deepEqual(await readFile(join(remote.root,'returned')),data);
 }finally{ssh.dispose();ftp.dispose();await remote.close();await server.close();}
});
test('real FTP streams copy binary files, preserve existing target and cancel',{timeout:20000},async()=>{
 const a=await ftpFixture(),b=await ftpFixture(),ftp=new FtpService(()=>{});
 const profile=(port:number)=>({id:randomUUID(),protocol:'ftp' as const,host:'127.0.0.1',port,username:'fixture'});
 try{
 let x=await ftp.connect(profile(a.port),{password:'fixture'}),y=await ftp.connect(profile(b.port),{password:'fixture'});
 const bytes=Buffer.alloc(1024*1024+31,37);a.files.set('/payload',bytes);
 const perform=async(path:string,signal:AbortSignal)=>{const source=providerFileCall({ftp,sessionId:x.sessionId},signal),target=providerFileCall({ftp,sessionId:y.sessionId},signal);try{return await copyMachineFile(source.call,{root:'',path:'/payload'},target.call,{root:'',path},signal,()=>{});}finally{await Promise.all([source.dispose(),target.dispose()]);}};
 const result=await perform('/copied',new AbortController().signal);assert.deepEqual(b.files.get('/copied'),bytes);assert.equal(result.sha256,createHash('sha256').update(bytes).digest('hex'));
 await assert.rejects(perform('/copied',new AbortController().signal),/已存在/);assert.deepEqual(b.files.get('/copied'),bytes);
 if(!ftp.has(x.sessionId))x=await ftp.connect(profile(a.port),{password:'fixture'});a.state.slowDownload=true;const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),100);try{await assert.rejects(perform('/cancel',controller.signal));}finally{clearTimeout(timer);}assert.equal(b.files.has('/cancel'),false);
 }finally{ftp.dispose();await a.close();await b.close();}
});
