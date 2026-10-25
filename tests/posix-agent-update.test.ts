import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,copyFile,chmod,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {prepareAgentReplacement} from '../src/agent/posix-update';
import {callAgent} from '../src/agent/control';
import {updateDaemonSource} from './helpers/update-daemon';
const exec=promisify(execFile);
for(const mode of ['normal','wrong-identity'])test('Unix staged replacement '+(mode==='normal'?'commits after real identity handshake':'rolls back and restores the original daemon'),{skip:process.platform==='win32',timeout:20000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'cagent-update-package-')),originalExecutable=process.execPath,originalArgs=[...process.argv];
 const root=join(dir,'installed'),incoming=join(dir,'incoming'),data=join(dir,'data'),archive=join(dir,'new.tar.gz');
 try{
  for(const path of [root,incoming,data,join(incoming,'node_modules','node-pty')])await mkdir(path,{recursive:true});
  const info={version:'0.8.9',platform:process.platform,arch:process.arch,electron:false};
  await writeFile(join(root,'build-info.json'),JSON.stringify(info));await copyFile(originalExecutable,join(root,'node'));await chmod(join(root,'node'),0o755);
  await writeFile(join(root,'agent.cjs'),updateDaemonSource('0.8.9'));
  await copyFile(originalExecutable,join(incoming,'node'));await chmod(join(incoming,'node'),0o755);
  await writeFile(join(incoming,'build-info.json'),JSON.stringify({...info,version:'0.8.10'}));
  await writeFile(join(incoming,'cagent'),'#!/bin/sh');await writeFile(join(incoming,'node_modules','node-pty','index.js'),'module.exports={}');
  await writeFile(join(incoming,'agent.cjs'),updateDaemonSource('0.8.10',mode));await writeFile(join(data,'identity'),'preserved-device');
  await exec('tar',['-czf',archive,'-C',incoming,'.']);
  process.execPath=join(root,'node');process.argv=[process.execPath,join(root,'agent.cjs'),'run'];
  const plan=await prepareAgentReplacement(archive,'0.8.10',data,'preserved-device');
  assert.equal(JSON.parse(await readFile(join(root,'build-info.json'),'utf8')).version,'0.8.9');
  if(mode==='normal')await plan.commit();else await assert.rejects(plan.commit(),/身份/);
  const expected=mode==='normal'?'0.8.10':'0.8.9';
  assert.equal((await callAgent('client.status',undefined,data)).agentVersion,expected);
  assert.equal(await readFile(join(data,'identity'),'utf8'),'preserved-device');
  assert.equal(JSON.parse(await readFile(join(root,'build-info.json'),'utf8')).version,expected);
  assert.equal(JSON.parse(await readFile(join(data,'update-result.json'),'utf8')).state,mode==='normal'?'completed':'rolled-back');
 }finally{
  await callAgent('agent.shutdown',{confirm:true},data).catch(()=>{});await new Promise(resolve=>setTimeout(resolve,100));
  process.execPath=originalExecutable;process.argv=originalArgs;await rm(dir,{recursive:true,force:true});
 }
});
