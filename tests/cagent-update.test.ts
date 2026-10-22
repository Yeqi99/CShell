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
 try{const updater=new AgentUpdater(directory,'0.6.19');await updater.check();updater.start();while(updater.status().phase==='downloading')await new Promise(r=>setTimeout(r,10));assert.equal(updater.status().phase,'ready');assert.deepEqual(await readFile(updater.status().path),data);await updater.verify();await writeFile(updater.status().path,'tampered');await assert.rejects(()=>updater.verify(),/更新文件已改变/);corrupt=true;updater.start();while(updater.status().phase==='downloading')await new Promise(r=>setTimeout(r,10));assert.equal(updater.status().phase,'failed');assert.equal(updater.status().path,undefined);}finally{globalThis.fetch=original;await rm(directory,{recursive:true,force:true});}
});
