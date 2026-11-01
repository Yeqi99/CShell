import assert from 'node:assert/strict';
import {spawn, type ChildProcess} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import {callAgent} from '../src/agent/control';
const version=JSON.parse(await readFile('package.json','utf8')).version;
const staged=resolve(process.argv[2]||`release/${version}/agent-${process.platform}-${process.arch}`);
const data=await mkdtemp(join(tmpdir(),'cagent-pro-package-'));
let child:ChildProcess|undefined;
async function start(){
 child=spawn(join(staged,process.platform==='win32'?'node.exe':'node'),[join(staged,'agent.cjs'),'run'],{env:{...process.env,CSHELL_AGENT_DATA:data},stdio:'ignore',windowsHide:true});
 let launchError:Error|undefined;child.once('error',error=>{launchError=error});
 const deadline=Date.now()+60000;
 while(Date.now()<deadline){if(launchError)throw launchError;if(child.exitCode!==null||child.signalCode!==null)throw Error('Packaged Pro CAgent exited during startup');try{await callAgent('account.status',{},data,AbortSignal.timeout(1000));return}catch{}await new Promise(r=>setTimeout(r,100));}
 throw Error('Packaged Pro account API unavailable');
}
async function stop(){
 const target=child;if(!target)return;
 await callAgent('agent.shutdown',{confirm:true},data,AbortSignal.timeout(3000)).catch(()=>{});
 if(target.exitCode===null&&target.signalCode===null){await Promise.race([once(target,'exit'),new Promise(r=>setTimeout(r,3000))]);if(target.exitCode===null&&target.signalCode===null){target.kill();await Promise.race([once(target,'exit'),new Promise(r=>setTimeout(r,3000))]);}}
 assert.ok(target.exitCode!==null||target.signalCode!==null,'isolated fixture did not exit before cleanup');
 child=undefined;
}
try{
 await start();
 const status=await callAgent('account.status',{},data);assert.equal(status.unlocked,false);
 const appearance=await callAgent('account.appearance',{theme:'dark',uiFontSize:18},data);
 assert.equal(appearance.theme,'dark');assert.equal(appearance.uiFontSize,18);
 await assert.rejects(callAgent('account.appearance',{mcp:{enabled:true}},data));
 assert.equal((await callAgent('client.status',{},data)).running,false);
 await stop();await start();
 const restored=await callAgent('account.appearance',{},data);assert.equal(restored.theme,'dark');assert.equal(restored.uiFontSize,18);
 assert.equal((await callAgent('account.status',{},data)).unlocked,false);
 assert.equal((await callAgent('client.status',{},data)).running,false);
 console.log('PASS actual packaged Pro account API, encrypted guest appearance restart, no login or listener grants');
}finally{await stop();await rm(data,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
