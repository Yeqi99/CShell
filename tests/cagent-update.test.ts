import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {AgentUpdater,selectUpdate} from '../src/agent/update';
const data=Buffer.from('installer fixture'),digest='sha256:'+createHash('sha256').update(data).digest('hex');
const release={assets:[{name:'CAgent-Setup-0.6.20-win-x64.exe',browser_download_url:'https://shell.canp.ai/downloads/opensource/v0.6.20/CAgent-Setup-0.6.20-win-x64.exe',digest,size:data.length}]};
test('update selection rejects wrong origin, platform, digest and downgrades',()=>{
 assert.equal(selectUpdate([release],'0.6.19','x64')?.version,'0.6.20');assert.equal(selectUpdate([release],'0.6.20','x64'),undefined);assert.equal(selectUpdate([release],'0.6.19','arm64'),undefined);
 for(const patch of [{digest:undefined},{browser_download_url:'https://evil.example/a.exe'}])assert.equal(selectUpdate([{assets:[{...release.assets[0],...patch}]}],'0.6.19','x64'),undefined);
 assert.equal(selectUpdate([{...release,draft:true}],'0.6.19','x64'),undefined);
});
test('download verifies bytes before exposing installer and rejects corruption',{skip:process.platform!=='win32'||process.arch!=='x64'},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'cagent-update-')),original=globalThis.fetch;let corrupt=false;
 globalThis.fetch=(async(url:any)=>new Response(String(url).endsWith('releases.json')?JSON.stringify([release]):corrupt?Buffer.from('invalid installer'):data)) as typeof fetch;
 try{const updater=new AgentUpdater(directory,'0.6.19',globalThis.fetch);await updater.check();updater.start();while(updater.status().phase==='downloading')await new Promise(r=>setTimeout(r,10));assert.equal(updater.status().phase,'ready');assert.deepEqual(await readFile(updater.status().path),data);await updater.verify();await writeFile(updater.status().path,'tampered');await assert.rejects(()=>updater.verify(),/更新文件已改变/);corrupt=true;updater.start();while(updater.status().phase==='downloading')await new Promise(r=>setTimeout(r,10));assert.equal(updater.status().phase,'failed');assert.equal(updater.status().path,undefined);}finally{globalThis.fetch=original;await rm(directory,{recursive:true,force:true});}
});

test('closing updater aborts pending check and rejects subsequent work',{skip:process.platform!=='win32'},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'cagent-update-close-')),original=globalThis.fetch;
 let signal:AbortSignal|undefined;
 globalThis.fetch=((_url:any,options:any)=>{signal=options.signal;return new Promise((_resolve,reject)=>{signal!.addEventListener('abort',()=>reject(signal!.reason),{once:true});});}) as typeof fetch;
 const updater=new AgentUpdater(directory,'0.6.19',globalThis.fetch);
 try{
  const check=updater.check();const rejected=assert.rejects(check,/更新服务已关闭/);
  updater.close();await rejected;assert.equal(signal?.aborted,true);
  await assert.rejects(updater.check(),/更新服务已关闭/);
  assert.throws(()=>updater.start(),/更新服务已关闭/);
  updater.close();
 }finally{updater.close();globalThis.fetch=original;await rm(directory,{recursive:true,force:true});}
});

test('closing updater cancels streaming download without exposing installer',{skip:process.platform!=='win32'||process.arch!=='x64'},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'cagent-update-stream-')),original=globalThis.fetch;
 let downloadSignal:AbortSignal|undefined;
 globalThis.fetch=(async(url:any,options:any)=>{
  if(String(url).endsWith('releases.json'))return new Response(JSON.stringify([release]));
  downloadSignal=options.signal;
  return new Response(new ReadableStream({start(controller){controller.enqueue(data.subarray(0,2));downloadSignal!.addEventListener('abort',()=>controller.error(downloadSignal!.reason),{once:true});}}));
 }) as typeof fetch;
 const updater=new AgentUpdater(directory,'0.6.19',globalThis.fetch);
 try{
  await updater.check();updater.start();
  for(let i=0;i<100&&!downloadSignal;i++)await new Promise(r=>setTimeout(r,10));
  assert.ok(downloadSignal);updater.close();assert.equal(downloadSignal.aborted,true);
  await new Promise(r=>setTimeout(r,30));assert.notEqual(updater.status().phase,'ready');
  await assert.rejects(readFile(join(directory,'updates',release.assets[0].name)),{code:'ENOENT'});
 }finally{updater.close();globalThis.fetch=original;await rm(directory,{recursive:true,force:true});}
});

test('Unix CAgent update channels select only the exact operating system and architecture',()=>{
 const name='CAgent-0.8.7-linux-arm64.tar.gz';
 const unix={assets:[{name,browser_download_url:'https://shell.canp.ai/downloads/pro/v0.8.7/'+name,digest,size:data.length}]};
 assert.equal(selectUpdate([unix],'0.8.6','arm64','linux')?.version,'0.8.7');
 assert.equal(selectUpdate([unix],'0.8.6','x64','linux'),undefined);
 assert.equal(selectUpdate([unix],'0.8.6','arm64','darwin'),undefined);
 assert.equal(selectUpdate([unix],'0.8.6','arm64','win32'),undefined);
});
