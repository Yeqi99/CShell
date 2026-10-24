import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,copyFile,chmod,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {prepareAgentReplacement} from '../src/agent/posix-update';
const exec=promisify(execFile);
test('Unix CAgent performs a real staged package replacement and restarts with the same data directory',{skip:process.platform==='win32'},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'cagent-update-package-'));const originalExecutable=process.execPath,originalArgs=[...process.argv];
 try{
  const root=join(dir,'installed'),incoming=join(dir,'incoming'),data=join(dir,'data'),archive=join(dir,'new.tar.gz');
  for(const path of [root,incoming,data,join(incoming,'node_modules')])await mkdir(path,{recursive:true});
  const info={version:'0.8.6',platform:process.platform,arch:process.arch,electron:false};
  await writeFile(join(root,'build-info.json'),JSON.stringify(info));await copyFile(originalExecutable,join(root,'node'));await chmod(join(root,'node'),0o755);
  await copyFile(originalExecutable,join(incoming,'node'));await chmod(join(incoming,'node'),0o755);
  await writeFile(join(incoming,'build-info.json'),JSON.stringify({...info,version:'0.8.7'}));
  await writeFile(join(incoming,'cagent'),'#!/bin/sh');
  await writeFile(join(incoming,'agent.cjs'),`require('node:fs').writeFileSync(require('node:path').join(process.env.CSHELL_AGENT_DATA,'restarted'),'ok')`);
  await writeFile(join(data,'identity'),'retain');
  await exec('tar',['-czf',archive,'-C',incoming,'.']);
  process.execPath=join(root,'node');process.argv=[process.execPath,join(root,'agent.cjs'),'run'];
  const plan=await prepareAgentReplacement(archive,'0.8.7',data);
  assert.equal(JSON.parse(await readFile(join(root,'build-info.json'),'utf8')).version,'0.8.6');
  plan.commit();
  let marker='';for(let i=0;i<100;i++){try{marker=await readFile(join(data,'restarted'),'utf8');break;}catch{await new Promise(r=>setTimeout(r,25));}}
  assert.equal(marker,'ok');assert.equal(await readFile(join(data,'identity'),'utf8'),'retain');
  assert.equal(JSON.parse(await readFile(join(root,'build-info.json'),'utf8')).version,'0.8.7');
 }finally{process.execPath=originalExecutable;process.argv=originalArgs;await rm(dir,{recursive:true,force:true});}
});
