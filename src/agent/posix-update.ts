import { access, mkdir, readFile, readdir, realpath, rm, lstat, writeFile, chmod } from 'node:fs/promises';
import { constants, renameSync, existsSync, symlinkSync, unlinkSync } from 'node:fs';
import { dirname, join, relative, isAbsolute } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import {launchUpdatedAgent,awaitUpdatedAgent,releaseUpdatedAgent,stopPreparedAgent,UpdateCommitUncertain,type UpdateChild} from './update-handoff';
const execute = promisify(execFile);
const shellQuote=(value:string)=>"'"+value.replace(/'/g,"'\\''")+"'";

/** Prepare without touching the running program. Commit is only called behind
 * the runtime's activity/admission barrier. The new daemon stays gated until its
 * authenticated local handshake proves both device identity and version. */
export async function prepareAgentReplacement(archive: string, version: string, dataDirectory: string, expectedIdentity?:string) {
  if (process.platform === 'win32') throw Error('Windows 使用原生安装程序更新');
  if(!expectedIdentity)throw Error('缺少更新目标身份，不能替换运行程序');
  const root = await realpath(dirname(process.argv[1]));
  const executable=await realpath(process.execPath);
  const flat=await realpath(join(root,'node')).then(p=>p===executable,()=>false);
  const bootstrap=!flat&&await realpath(join(root,'runtime','bin','node')).then(p=>p===executable,()=>false);
  if(!flat&&!bootstrap)throw Error('请通过 CAgent 独立运行包启动后更新，不修改系统 Node');
  const data=await realpath(dataDirectory),inside=relative(root,data);
  if(!inside||(!inside.startsWith('..')&&!isAbsolute(inside)))throw Error('数据目录位于程序内，请先将数据迁移到独立目录后更新');
  const base=bootstrap?dirname(dirname(root)):undefined;
  let oldVersion:string;
  if(base){
    if(await realpath(join(base,'current'))!==root||await realpath(join(base,'data'))!==data)throw Error('SSH 安装目录或数据身份不匹配');
    oldVersion=JSON.parse(await readFile(join(root,'build-info.json'),'utf8')).version;
  }else{
    const old=JSON.parse(await readFile(join(root,'build-info.json'),'utf8'));
    if(old.platform!==process.platform||old.arch!==process.arch||old.electron!==false)throw Error('当前安装身份无法验证');
    oldVersion=old.version;
  }
  await access(dirname(root),constants.W_OK);
  const stage=root+'.update-'+randomUUID(),backup=root+'.previous-'+randomUUID();
  await mkdir(stage,{mode:0o700});
  try{
    const names=(await execute('tar',['-tzf',archive],{maxBuffer:8*1024*1024})).stdout.split('\n').filter(Boolean);
    if(names.some(name=>name.startsWith('/')||name.split('/').includes('..')))throw Error('安装包包含无效路径');
    const details=(await execute('tar',['-tvzf',archive],{maxBuffer:16*1024*1024})).stdout.split('\n').filter(Boolean);
    if(details.some(line=>!['-','d'].includes(line[0])))throw Error('安装包包含不支持的链接或设备文件');
    await execute('tar',['-xzf',archive,'-C',stage]);
    const info=JSON.parse(await readFile(join(stage,'build-info.json'),'utf8'));
    if(info.version!==version||info.platform!==process.platform||info.arch!==process.arch||info.electron!==false)throw Error('更新包版本或平台不符');
    for(const name of ['node','agent.cjs','cagent'])if(!(await lstat(join(stage,name))).isFile())throw Error('更新包不完整');
    if(!(await readdir(stage)).includes('node_modules'))throw Error('更新包缺少运行依赖');
    await access(join(stage,'node'),constants.X_OK);
    await execute(join(stage,'node'),['-e',"require('node-pty')"],{cwd:stage,timeout:15000,maxBuffer:65536});
    if(base){
      await writeFile(join(stage,'cagent'),`#!/bin/sh\nexport CSHELL_AGENT_DATA=${shellQuote(data)}\nexec "$(dirname "$0")/node" "$(dirname "$0")/agent.cjs" "$@"\n`);
      await chmod(join(stage,'cagent'),0o755);
    }
  }catch(error){await rm(stage,{recursive:true,force:true});throw error;}
  let committed=false;
  const switchLink=(target:string)=>{
    const temporary=join(base!,'current.update-'+randomUUID());symlinkSync(target,temporary);
    try{renameSync(temporary,join(base!,'current'));}finally{if(existsSync(temporary))unlinkSync(temporary);}
  };
  const restore=async()=>{await writeFile(join(data,'update-result.json'),JSON.stringify({version,state:'rollback-pending',at:Date.now()}));const restored=launchUpdatedAgent(root,data);await awaitUpdatedAgent(restored,data,expectedIdentity,oldVersion,false);};
  return {
    cancel:async()=>{if(!committed)await rm(stage,{recursive:true,force:true});},
    recover:restore,
    async commit(){
      let child:UpdateChild|undefined;
      let accepted=false;
      const target=base?stage:root;
      try{
        if(base)switchLink(stage);else{renameSync(root,backup);try{renameSync(stage,root);}catch(error){if(!existsSync(root))renameSync(backup,root);throw error;}}
        committed=true;
        const token=randomBytes(32).toString('hex');child=launchUpdatedAgent(target,data,token);
        const endpoint=await awaitUpdatedAgent(child,data,expectedIdentity,version,true);
        await releaseUpdatedAgent(endpoint,expectedIdentity,version,token);
        accepted=true;
        // After releasing admission, logging/UI failures must never roll back an
        // accepted daemon which may already have user work.
        await writeFile(join(data,'update-result.json'),JSON.stringify({version,state:'completed',at:Date.now()})).catch(()=>{});
        if(['app','app-host','restart-app-host'].includes(process.argv[2])){
          const app=spawn(join(target,'node'),[join(target,'agent.cjs'),'app'],{detached:true,stdio:'ignore',env:{...process.env,CSHELL_AGENT_DATA:data}});app.on('error',()=>{});app.unref();
        }
      }catch(error){
        if(accepted)return;
        if(error instanceof UpdateCommitUncertain)throw error;
        if(child)await stopPreparedAgent(child,data);
        if(committed){
          if(base)switchLink(root);else{renameSync(root,stage);renameSync(backup,root);}
          await restore();
          await writeFile(join(data,'update-result.json'),JSON.stringify({version,state:'rolled-back',at:Date.now(),reason:'更新后台未通过身份与版本核验，已恢复原程序'})).catch(()=>{});
        }else{
          // Even a rename failure happens after the old runtime was shut down.
          await restore();
        }
        throw error;
      }
    },
  };
}
