import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { discoverAgent, callDiscoveredAgent, type AgentDiscovery } from './control';

const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const ended=(child:ChildProcess)=>child.exitCode!==null||child.signalCode!==null;
export class UpdateCommitUncertain extends Error {}

/** Only children created by this update may be stopped. No process-name scans. */
export function launchUpdatedAgent(directory:string,data:string,token?:string){
  const node=process.platform==='win32'?join(directory,'node.exe'):
    existsSync(join(directory,'node'))?join(directory,'node'):join(directory,'runtime','bin','node');
  const child=spawn(node,[join(directory,'agent.cjs'),'run'],{detached:true,stdio:'ignore',windowsHide:true,
    env:{...process.env,CSHELL_AGENT_DATA:data,...(token?{CSHELL_AGENT_UPDATE_COMMIT:token}:{})}});
  // Keep an error listener from spawn onwards, including before the first await.
  let failure:Error|undefined;child.on('error',error=>{failure=error;});child.unref();
  return {child,failure:()=>failure};
}
export type UpdateChild=ReturnType<typeof launchUpdatedAgent>;
const call=(endpoint:AgentDiscovery,method:string,params?:unknown)=>
  callDiscoveredAgent(endpoint,method,params,AbortSignal.timeout(3000));

export async function awaitUpdatedAgent(owned:UpdateChild,data:string,identity:string,version:string,pending:boolean){
  const deadline=Date.now()+30000;
  while(Date.now()<deadline){
    if(owned.failure()||ended(owned.child))throw owned.failure()??Error('更新后台未能启动');
    const endpoint=await discoverAgent(data).catch(()=>undefined);
    if(endpoint&&endpoint.pid===owned.child.pid){
      const status=await call(endpoint,'client.status');
      if(status.deviceId!==identity||status.agentVersion!==version||status.updateProtocol!==1||status.updatePendingCommit!==pending)
        throw Error('更新后台身份或版本核验失败');
      return endpoint;
    }
    await sleep(200);
  }
  throw Error('更新后台启动超时');
}

/** Once commit might have been accepted, never kill or replay it: new tasks may
 * already be running. A read-only status check can resolve a lost response. */
export async function releaseUpdatedAgent(endpoint:AgentDiscovery,identity:string,version:string,token:string){
  try{
    const result=await call(endpoint,'update.commit',{token});
    if(result.committed!==true||result.deviceId!==identity||result.agentVersion!==version)throw Error('更新提交未确认');
  }catch{
    for(let i=0;i<10;i++){
      try{
        const status=await call(endpoint,'client.status');
        if(status.deviceId===identity&&status.agentVersion===version&&status.updateProtocol===1&&status.updatePendingCommit===false)return;
      }catch{}
      await sleep(200);
    }
    throw new UpdateCommitUncertain('更新交接结果尚未确认，已保留新旧程序；未终止新后台或重放任务');
  }
}
export async function stopPreparedAgent(owned:UpdateChild,data:string){
  if(owned.failure()||ended(owned.child)||!owned.child.pid)return;
  const endpoint=await discoverAgent(data).catch(()=>undefined);
  if(endpoint&&endpoint.pid===owned.child.pid)await call(endpoint,'agent.shutdown',{confirm:true}).catch(()=>{});
  for(let i=0;i<20&&!ended(owned.child);i++)await sleep(100);
  if(!ended(owned.child)){owned.child.kill('SIGTERM');for(let i=0;i<20&&!ended(owned.child);i++)await sleep(100);}
  if(!ended(owned.child))throw Error('更新后台尚未退出，保留两个版本以便恢复');
}
