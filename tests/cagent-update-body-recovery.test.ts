import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {AgentUpdater} from '../src/agent/update';
import type {updateRequest} from '../src/agent/update-request';
const bytes=Buffer.from('verified update body');
const name=process.platform==='win32'?`CAgent-Setup-99.0.0-win-${process.arch}.exe`:`CAgent-99.0.0-${process.platform==='darwin'?'mac':'linux'}-${process.arch}.tar.gz`;
const primary='https://shell.canp.ai/downloads/pro/v99.0.0/'+name;
const official='https://github.com/Yeqi99/CShell/releases/download/pro-v99.0.0/'+name;
const catalog=[{assets:[{name,browser_download_url:primary,size:bytes.length,digest:'sha256:'+createHash('sha256').update(bytes).digest('hex')}]}];
async function finish(updater:AgentUpdater){for(let i=0;i<200&&updater.status().phase==='downloading';i++)await new Promise(r=>setTimeout(r,10));return updater.status();}
for(const recover of [true,false])test('interrupted update body '+(recover?'recovers exact artifact from official source':'stops after bounded retries with useful error'),async()=>{
 const directory=await mkdtemp(join(tmpdir(),'update-body-'));const calls:string[]=[];
 const request:typeof updateRequest=async(url)=>{calls.push(url);if(url.endsWith('releases.json'))return new Response(JSON.stringify(catalog));if(url===official&&recover)return new Response(bytes);return new Response(new ReadableStream({start(c){c.enqueue(bytes.subarray(0,3));c.error(new Error('aborted'));}}));};
 const updater=new AgentUpdater(directory,'0.8.16',request);
 try{await updater.check();updater.start();const status=await finish(updater);assert.equal(calls.filter(u=>u===primary).length,1);assert.equal(calls.filter(u=>u===official).length,recover?1:2);
 if(recover){assert.equal(status.phase,'ready');assert.deepEqual(await readFile(status.path),bytes);await updater.verify();}
 else{assert.equal(status.phase,'failed');assert.match(status.error,/尝试 3 次/);assert.doesNotMatch(status.error,/aborted/);await assert.rejects(readFile(join(directory,'updates',name)),{code:'ENOENT'});}
 }finally{updater.close();await rm(directory,{recursive:true,force:true});}
});
test('closing a broken download never starts fallback or exposes an installer',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'update-close-'));let updater:AgentUpdater;const calls:string[]=[];
 const request:typeof updateRequest=async(url)=>{calls.push(url);if(url.endsWith('releases.json'))return new Response(JSON.stringify(catalog));return new Response(new ReadableStream({start(c){updater.close();c.error(new Error('aborted'));}}));};
 updater=new AgentUpdater(directory,'0.8.16',request);try{await updater.check();updater.start();await new Promise(r=>setTimeout(r,80));assert.deepEqual(calls,[ 'https://shell.canp.ai/downloads/pro/releases.json',primary]);assert.notEqual(updater.status().phase,'ready');await assert.rejects(readFile(join(directory,'updates',name)),{code:'ENOENT'});}finally{updater.close();await rm(directory,{recursive:true,force:true});}
});
