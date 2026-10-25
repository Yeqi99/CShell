import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {mkdtemp,writeFile,readFile,rm,readdir} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import selfsigned from 'selfsigned';
import {FtpService} from '../src/core/ftp';import {FtpConnectionProvider,ftpIdentity} from '../src/core/connections/ftp-provider';import {ConnectionRegistry} from '../src/core/connections/registry';import {ftpFixture} from './helpers/ftp-server';
const profile=(port:number,protocol:'ftp'|'ftps'='ftp')=>({id:randomUUID(),name:'Fixture',protocol,host:'127.0.0.1',port,username:'fixture'});

test('idle FTP and FTPS disconnects notify once, release the session and allow an explicit new connection',{timeout:30000},async()=>{
 const generated=await selfsigned.generate([{name:'commonName',value:'localhost'}],{keySize:2048,extensions:[{name:'basicConstraints',cA:true},{name:'subjectAltName',altNames:[{type:7,ip:'127.0.0.1'}]}]});
 for(const protocol of ['ftp','ftps'] as const){
  const server=await ftpFixture(protocol==='ftps'?{cert:generated.cert,key:generated.private}:undefined),events:any[]=[],ftp=new FtpService(e=>events.push(e),{ca:generated.cert});
  try{
   const p=profile(server.port,protocol),{sessionId}=await ftp.connect(p,{password:'fixture'});await ftp.list(sessionId,'/');
   const commandsBefore=server.commands.length;server.disconnectAll();
   const deadline=Date.now()+3000;while(ftp.has(sessionId)&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
   assert.equal(ftp.has(sessionId),false,protocol+' idle connection is removed without a follow-up operation');assert.equal(ftp.size,0);
   assert.equal(events.filter(e=>e.type==='closed'&&e.sessionId===sessionId).length,1);assert.match(events[0].error,/未自动/);
   assert.equal(server.commands.slice(commandsBefore).some(c=>c.startsWith('USER')||c.startsWith('RETR')||c.startsWith('STOR')),false,'disconnect never reconnects or replays');
   const next=await ftp.connect(p,{password:'fixture'});assert.notEqual(next.sessionId,sessionId);assert.ok((await ftp.list(next.sessionId,'/')).entries.some(e=>e.name==='hello.txt'));ftp.disconnect(next.sessionId);
   assert.equal(events.filter(e=>e.type==='closed'&&e.sessionId===next.sessionId).length,1);
  }finally{ftp.dispose();await server.close();}
 }
});
test('FTP real control/data protocol lists, transfers, creates, renames and deletes only empty directories',{timeout:30000},async()=>{
 const server=await ftpFixture(),events:any[]=[],ftp=new FtpService(e=>events.push(e)),dir=await mkdtemp(join(tmpdir(),'cshell-ftp-'));
 try{
  const p=profile(server.port),{sessionId,home}=await ftp.connect(p,{password:'fixture-password'});assert.equal(home,'/');assert.equal(ftp.size,1);
  const first=await ftp.list(sessionId,'.');assert.equal(first.path,'/');assert.equal(first.entries.find(e=>e.name==='hello.txt')?.size,Buffer.byteLength('hello 中文\n'));
  await assert.rejects(ftp.action(sessionId,{action:'delete',path:'/docs',directory:true}),/不为空/);assert.ok(server.files.has('/docs/note.txt'));
  await ftp.action(sessionId,{action:'mkdir',path:'/empty'});await ftp.action(sessionId,{action:'delete',path:'/empty',directory:true});assert.equal(server.dirs.has('/empty'),false);
  const source=join(dir,'input.txt'),target=join(dir,'output.txt');await writeFile(source,'new file\n中文');const progress:number[]=[];
  await ftp.upload(sessionId,source,'/uploaded.txt',undefined,done=>progress.push(done));assert.equal(server.files.get('/uploaded.txt')?.toString(),'new file\n中文');assert.equal(progress.at(-1),Buffer.byteLength('new file\n中文'));
  await ftp.download(sessionId,'/uploaded.txt',target);assert.equal(await readFile(target,'utf8'),'new file\n中文');await assert.rejects(ftp.download(sessionId,'/uploaded.txt',target),/EEXIST/);assert.equal(await readFile(target,'utf8'),'new file\n中文');
  await assert.rejects(ftp.upload(sessionId,source,'/uploaded.txt'),/已存在/);await ftp.action(sessionId,{action:'rename',path:'/uploaded.txt',destination:'/renamed.txt'});await ftp.action(sessionId,{action:'delete',path:'/renamed.txt'});assert.equal(server.files.has('/renamed.txt'),false);
  assert.deepEqual((await readdir(dir)).sort(),['input.txt','output.txt']);ftp.disconnect(sessionId);assert.equal(events.filter(e=>e.type==='closed').length,1);
 }finally{ftp.dispose();await server.close();await rm(dir,{recursive:true,force:true});}
});
test('FTPS checks certificates, uses TLS for both channels, and never logs in via plaintext fallback',{timeout:30000},async()=>{
 const generated=await selfsigned.generate([{name:'commonName',value:'localhost'}],{keySize:2048,extensions:[{name:'basicConstraints',cA:true},{name:'subjectAltName',altNames:[{type:2,value:'localhost'},{type:7,ip:'127.0.0.1'}]}]});
 const server=await ftpFixture({cert:generated.cert,key:generated.private}),plain=new FtpService(()=>{}),trusted=new FtpService(()=>{},{ca:generated.cert});
 try{
  await assert.rejects(plain.connect(profile(server.port,'ftps'),{password:'protected'}));assert.equal(server.commands.some(c=>c.startsWith('USER')),false);
  const {sessionId}=await trusted.connect(profile(server.port,'ftps'),{password:'protected'});await trusted.list(sessionId,'/');assert.ok(server.state.tlsDataConnections>0);assert.ok(server.commands.includes('PROT P'));
  assert.ok(server.commands.filter(c=>c==='AUTH TLS').length>=2);
 }finally{plain.dispose();trusted.dispose();await server.close();}
 const unsupported=await ftpFixture(),client=new FtpService(()=>{});try{await assert.rejects(client.connect(profile(unsupported.port,'ftps'),{password:'protected'}));assert.equal(unsupported.commands.some(c=>c.startsWith('USER')),false);}finally{client.dispose();await unsupported.close();}
 const wrong=await selfsigned.generate([{name:'commonName',value:'wrong.example'}],{keySize:2048,extensions:[{name:'basicConstraints',cA:true},{name:'subjectAltName',altNames:[{type:2,value:'wrong.example'}]}]});
 const mismatch=await ftpFixture({cert:wrong.cert,key:wrong.private}),checked=new FtpService(()=>{},{ca:wrong.cert});try{await assert.rejects(checked.connect(profile(mismatch.port,'ftps'),{password:'protected'}),/altname|IP:|certificate/i);assert.equal(mismatch.commands.some(c=>c.startsWith('USER')),false);}finally{checked.dispose();await mismatch.close();}
});
test('cancel closes actual data/control sockets; a lost mutation reply is unknown and never replayed',{timeout:30000},async()=>{
 const server=await ftpFixture(),ftp=new FtpService(()=>{}),dir=await mkdtemp(join(tmpdir(),'cshell-ftp-cancel-'));
 try{
  let {sessionId}=await ftp.connect(profile(server.port),{password:'fixture'});server.files.set('/large.bin',Buffer.alloc(2*1024*1024,1));server.state.slowDownload=true;
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),150);
  try{await assert.rejects(ftp.download(sessionId,'/large.bin',join(dir,'cancelled.bin'),controller.signal));}finally{clearTimeout(timer);}
  assert.equal(ftp.has(sessionId),false);assert.deepEqual(await readdir(dir),[]);
  server.state.slowDownload=false;({sessionId}=await ftp.connect(profile(server.port),{password:'fixture'}));server.state.dropRename=true;
  await assert.rejects(ftp.action(sessionId,{action:'rename',path:'/hello.txt',destination:'/moved.txt'}),/结果未确认/);
  assert.ok(server.files.has('/moved.txt'));assert.equal(server.commands.filter(c=>c==='RNTO /moved.txt').length,1);assert.equal(ftp.has(sessionId),false);
 }finally{ftp.dispose();await server.close();await rm(dir,{recursive:true,force:true});}
});
test('FTP provider has only file capabilities, rejects command injection and revalidates delayed authorization',{timeout:30000},async()=>{
 const server=await ftpFixture(),ftp=new FtpService(()=>{}),provider=new FtpConnectionProvider(ftp);try{
  const p=profile(server.port),{sessionId}=await ftp.connect(p,{password:'fixture'}),connection=provider.resolve(sessionId);assert.equal(connection.terminal,undefined);assert.equal(connection.agent,undefined);assert.equal(connection.http,undefined);assert.notEqual(ftpIdentity(p),ftpIdentity({...p,protocol:'ftps'}));
  await assert.rejects(ftp.list(sessionId,'/\r\nDELE /hello.txt'));assert.ok(server.files.has('/hello.txt'));
  const registry=new ConnectionRegistry(()=>({id:p.id,group:''}));registry.register(provider);registry.bind(sessionId,provider.id);
  const denied=registry.prepare(sessionId,'ftp_create_text',{path:'/denied.txt',content:'secret',acceptNonAtomic:true});await assert.rejects(denied.execute(()=>false,new AbortController().signal),/revoked/);assert.equal(server.files.has('/denied.txt'),false);
  const create=registry.prepare(sessionId,'ftp_create_text',{path:'/created.txt',content:'allowed',acceptNonAtomic:true});await create.execute(()=>true,new AbortController().signal);assert.equal((await ftp.readText(sessionId,'/created.txt')).content,'allowed');
  await assert.rejects(create.execute(()=>true,new AbortController().signal),/consumed/);
  await assert.rejects(ftp.writeText(sessionId,'/revoked.txt','not written',undefined,()=>{throw Error('revoked');}),/revoked/);assert.equal(server.commands.some(c=>c.startsWith('STOR /revoked')),false);
 }finally{ftp.dispose();await server.close();}
});
test('passive FTP refuses a server-directed different transfer host before opening its connection',{timeout:5000},async()=>{
 const server=await ftpFixture(),ftp=new FtpService(()=>{});try{const {sessionId}=await ftp.connect(profile(server.port),{password:'fixture'});server.state.redirectPassive=true;await assert.rejects(ftp.list(sessionId,'/'),/host|strategy|connect/i);assert.equal(server.commands.filter(c=>c==='PASV').length,1);}finally{ftp.dispose();await server.close();}
});
