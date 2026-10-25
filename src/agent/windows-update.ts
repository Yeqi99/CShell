import {readFile,writeFile,rename,rm,realpath,lstat} from 'node:fs/promises';
import {join,dirname,basename,relative,isAbsolute} from 'node:path';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes,randomUUID} from 'node:crypto';
import {launchUpdatedAgent,awaitUpdatedAgent,releaseUpdatedAgent,stopPreparedAgent,UpdateCommitUncertain,type UpdateChild} from './update-handoff';
const execute=promisify(execFile);

/** The native installer verifies and adds an immutable version slot only. The
 * owning runtime switches its launcher after admission is closed and rolls it
 * back before restoring the original daemon if startup/identity checks fail. */
export async function prepareWindowsAgentReplacement(installer:string,version:string,data:string,identity:string,
  install:(file:string,args:string[])=>Promise<unknown>=(file,args)=>execute(file,args,{windowsHide:true,windowsVerbatimArguments:true,timeout:180000,maxBuffer:65536})){
  const runtime=await realpath(dirname(process.execPath));
  const parent=dirname(runtime),root=basename(parent).toLowerCase()==='versions'?dirname(parent):runtime;
  const installed=JSON.parse(await readFile(join(runtime,'build-info.json'),'utf8'));
  if(installed.platform!=='win32'||installed.arch!==process.arch||installed.electron!==false)throw Error('当前安装身份无法验证');
  const launcher=join(root,'Open CAgent.vbs');
  const previous=await readFile(launcher).catch(error=>{if(error.code==='ENOENT')return undefined;throw error;});
  const receipt=join(root,'prepared-update.json');await rm(receipt,{force:true});
  // /PREPARE must finish successfully before any runtime is closed.
  await install(installer,['/S','/PREPARE','/D='+root]);
  let prepared:any;
  try{prepared=JSON.parse(await readFile(receipt,'utf8'));}catch{
    // A pre-protocol installer may have changed only its launcher. Restore it;
    // it was invoked silently and never had permission to stop the daemon.
    if(previous)await writeFile(launcher,previous);else await rm(launcher,{force:true});
    throw Error('此安装包不支持安全自动交接，当前后台保持运行');
  }
  if(prepared.format!==1||prepared.version!==version||!/^[0-9A-Za-z._-]{1,100}$/.test(prepared.installId))throw Error('更新准备凭据无效');
  const target=await realpath(join(root,'versions',prepared.installId));
  const inside=relative(join(root,'versions'),target);
  if(!inside||inside.startsWith('..')||isAbsolute(inside)||target.toLowerCase()!==String(prepared.path).toLowerCase())throw Error('更新目录超出独立程序槽');
  const info=JSON.parse(await readFile(join(target,'build-info.json'),'utf8'));
  if(info.version!==version||info.platform!=='win32'||info.arch!==process.arch||info.electron!==false)throw Error('更新包版本或平台不符');
  for(const name of ['node.exe','agent.cjs','Cagent.exe'])if(!(await lstat(join(target,name))).isFile())throw Error('更新包不完整');
  await execute(join(target,'node.exe'),['-e',"require('node-pty')"],{cwd:target,windowsHide:true,timeout:15000,maxBuffer:65536});
  const atomic=async(bytes:Buffer)=>{const temporary=launcher+'.'+randomUUID()+'.tmp';try{await writeFile(temporary,bytes);await rename(temporary,launcher);}finally{await rm(temporary,{force:true});}};
  const restore=async()=>{await writeFile(join(data,'update-result.json'),JSON.stringify({version,state:'rollback-pending',at:Date.now()}));const old=launchUpdatedAgent(runtime,data);await awaitUpdatedAgent(old,data,identity,installed.version,false);};
  let committed=false;
  return {
    cancel:async()=>{await rm(receipt,{force:true});}, // Keep the independently verified immutable slot for retry.
    recover:restore,
    async commit(){
      let child:UpdateChild|undefined,accepted=false;
      try{
        const exe=join(target,'Cagent.exe').replaceAll('"','""');
        await atomic(Buffer.from('\ufeff'+'Set sh = CreateObject("WScript.Shell")\r\nsh.Run Chr(34) & "'+exe+'" & Chr(34), 1, False\r\n','utf16le'));committed=true;
        const token=randomBytes(32).toString('hex');child=launchUpdatedAgent(target,data,token);
        const endpoint=await awaitUpdatedAgent(child,data,identity,version,true);
        await releaseUpdatedAgent(endpoint,identity,version,token);accepted=true;
        await writeFile(join(data,'update-result.json'),JSON.stringify({version,state:'completed',at:Date.now()})).catch(()=>{});
        if(['app','app-host','restart-app-host'].includes(process.argv[2])){const app=spawn(join(target,'Cagent.exe'),[],{detached:true,stdio:'ignore',windowsHide:true,env:{...process.env,CSHELL_AGENT_DATA:data}});app.on('error',()=>{});app.unref();}
      }catch(error){
        if(accepted)return;
        if(error instanceof UpdateCommitUncertain)throw error;
        if(child)await stopPreparedAgent(child,data);
        if(committed){if(previous)await atomic(previous);else await rm(launcher,{force:true});}
        await restore();
        await writeFile(join(data,'update-result.json'),JSON.stringify({version,state:'rolled-back',at:Date.now()})).catch(()=>{});
        throw error;
      }
    },
  };
}
