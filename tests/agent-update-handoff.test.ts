import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,copyFile,chmod,readFile,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {launchUpdatedAgent,awaitUpdatedAgent,releaseUpdatedAgent,stopPreparedAgent,UpdateCommitUncertain,type UpdateChild} from '../src/agent/update-handoff';
import {updateDaemonSource} from './helpers/update-daemon';
test('real isolated daemon handshake checks identity/version and resolves a lost commit reply without replay',{timeout:20000},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'cagent-update-handoff-')),data=join(directory,'data');let owned:UpdateChild|undefined;
 try{
  await mkdir(data);await writeFile(join(data,'identity'),'preserved-device');
  const node=join(directory,process.platform==='win32'?'node.exe':'node');await copyFile(process.execPath,node);await chmod(node,0o755);
  for(const mode of ['normal','lost-response','wrong-identity','uncertain']){
   await writeFile(join(directory,'agent.cjs'),updateDaemonSource('0.8.10',mode));
   owned=launchUpdatedAgent(directory,data,'a'.repeat(64));
   if(mode==='wrong-identity')await assert.rejects(awaitUpdatedAgent(owned,data,'preserved-device','0.8.10',true),/身份/);
   else{
    const endpoint=await awaitUpdatedAgent(owned,data,'preserved-device','0.8.10',true);
    if(mode==='uncertain')await assert.rejects(releaseUpdatedAgent(endpoint,'preserved-device','0.8.10','a'.repeat(64)),UpdateCommitUncertain);
    else{await releaseUpdatedAgent(endpoint,'preserved-device','0.8.10','a'.repeat(64));assert.equal(await readFile(join(data,'accepted'),'utf8'),'0.8.10');}
   }
   await stopPreparedAgent(owned,data);owned=undefined;
  }
 }finally{if(owned)await stopPreparedAgent(owned,data);await rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
