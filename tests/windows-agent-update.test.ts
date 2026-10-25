import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,copyFile,readdir,rm} from 'node:fs/promises';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {createHash} from 'node:crypto';
import {prepareWindowsAgentReplacement} from '../src/agent/windows-update';import {callAgent} from '../src/agent/control';import {updateDaemonSource} from './helpers/update-daemon';
const exec=promisify(execFile);
for(const mode of ['normal','wrong-identity'])test('Windows native preparation '+(mode==='normal'?'keeps the active launcher until verified handoff':'restores the old launcher and daemon after failed handshake'),{skip:process.platform!=='win32',timeout:60000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'cagent-update-native-')),originalExecutable=process.execPath,originalArgs=[...process.argv];
 const root=join(dir,'installation'),runtime=join(root,'versions','old'),setup=join(dir,'setup'),payload=join(setup,'payload'),data=join(dir,'data');
 const launcher=join(root,'Open CAgent.vbs'),previous=Buffer.from('previous-launcher');
 try{
  for(const p of [runtime,data,join(payload,'node_modules','node-pty')])await mkdir(p,{recursive:true});
  await copyFile(originalExecutable,join(runtime,'node.exe'));await writeFile(join(runtime,'agent.cjs'),updateDaemonSource('0.8.9'));
  const info={version:'0.8.9',platform:'win32',arch:process.arch,electron:false};await writeFile(join(runtime,'build-info.json'),JSON.stringify(info));await writeFile(launcher,previous);await writeFile(join(data,'identity'),'preserved-device');
  await copyFile(originalExecutable,join(payload,'node.exe'));await writeFile(join(payload,'agent.cjs'),updateDaemonSource('0.8.10',mode));await writeFile(join(payload,'Cagent.exe'),'test launcher not executed');await writeFile(join(payload,'build-info.json'),JSON.stringify({...info,version:'0.8.10'}));await writeFile(join(payload,'node_modules','node-pty','index.js'),'module.exports={}');
  const files=[];for(const path of await readdir(payload,{recursive:true})){try{const bytes=await readFile(join(payload,path));files.push({path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}catch(error){if((error as NodeJS.ErrnoException).code!=='EISDIR'&&(error as NodeJS.ErrnoException).code!=='EPERM')throw error;}}
  await writeFile(join(setup,'deployment.json'),JSON.stringify({format:1,platform:'win32',arch:'x64',version:'0.8.10',installId:'0.8.10-fixture',files}));await copyFile(resolve('scripts/windows-deployment/Install-CAgent.ps1'),join(setup,'Install-CAgent.ps1'));
  process.execPath=join(runtime,'node.exe');process.argv=[process.execPath,join(runtime,'agent.cjs'),'run'];
  const plan=await prepareWindowsAgentReplacement('verified-fixture-installer','0.8.10',data,'preserved-device',async(file,args)=>{
   assert.equal(file,'verified-fixture-installer');assert.deepEqual(args,['/S','/PREPARE','/D='+root]);
   await exec('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',join(setup,'Install-CAgent.ps1'),'-Destination',root,'-PrepareOnly','-NoLaunch','-NoShortcuts'],{windowsHide:true,timeout:30000});
  });
  assert.deepEqual(await readFile(launcher),previous);assert.equal(await readFile(join(data,'identity'),'utf8'),'preserved-device');
  if(mode==='normal')await plan.commit();else await assert.rejects(plan.commit(),/身份/);
  const status=await callAgent('client.status',undefined,data);assert.equal(status.deviceId,'preserved-device');assert.equal(status.agentVersion,mode==='normal'?'0.8.10':'0.8.9');assert.equal(status.updatePendingCommit,false);
  if(mode==='wrong-identity')assert.deepEqual(await readFile(launcher),previous);else assert.match((await readFile(launcher)).toString('utf16le'),/0.8.10-fixture/);
  assert.equal(JSON.parse(await readFile(join(data,'update-result.json'),'utf8')).state,mode==='normal'?'completed':'rolled-back');
 }finally{await callAgent('agent.shutdown',{confirm:true},data).catch(()=>{});await new Promise(resolve=>setTimeout(resolve,150));process.execPath=originalExecutable;process.argv=originalArgs;await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
