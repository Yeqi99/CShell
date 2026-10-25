import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { linuxCompatibilityBridgeSource } from '../src/core/linux-workspace-compat';
import { linuxMachineSnapshotSource } from '../src/core/linux-machine-snapshot';
import { LinuxWorkspaceService } from '../src/core/linux-workspace';
import { isUnsupportedAgentMethod } from '../src/shared/agent-compatibility';
import { ApplicationService } from '../src/core/applications';

test('versioned SSH bridge forwards current methods to existing authenticated daemon without changing its identity', async () => {
  const directory=await mkdtemp(join(tmpdir(),'cshell-bridge-compat-'));
  const token='d'.repeat(64), seen:string[]=[], identity='existing-device-identity';
  const server=createServer((request,response)=>{
    assert.equal(request.headers.authorization,'Bearer '+token);
    assert.equal(request.socket.remoteAddress,'127.0.0.1');
    let body='';request.on('data',chunk=>body+=chunk);request.on('end',()=>{
      const call=JSON.parse(body);seen.push(call.method);
      response.setHeader('Content-Type','application/json');
      response.end(JSON.stringify({result:call.method==='client.status'?{deviceId:identity,agentVersion:'0.8.9',methods:['client.status','machine.snapshot']}:{hostname:'actual-target'}}));
    });
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const discovery=JSON.stringify({version:1,port:(server.address() as any).port,token,pid:process.pid});
  await writeFile(join(directory,'discovery.json'),discovery);
  const child=spawn(process.execPath,['-e',linuxCompatibilityBridgeSource,directory],{stdio:['pipe','pipe','pipe'],windowsHide:true});
  const reader=createInterface({input:child.stdout}), pending=new Map<string,(value:any)=>void>();
  let stderr='';child.stderr.on('data',value=>stderr+=value);
  reader.on('line',line=>{const value=JSON.parse(line);pending.get(value.id)?.(value);pending.delete(value.id);});
  const call=(method:string,params?:unknown)=>new Promise<any>((resolve,reject)=>{
    const id=randomUUID(),timer=setTimeout(()=>reject(Error('bridge response timeout')),5000);
    pending.set(id,value=>{clearTimeout(timer);resolve(value);});child.stdin.write(JSON.stringify({id,call:{method,params}})+'\n');
  });
  try {
    assert.equal((await call('client.status')).result.deviceId,identity);
    assert.equal((await call('machine.snapshot')).result.hostname,'actual-target');
    assert.match((await call('client.access',{password:'never-forward'})).error,/未在 SSH 工作区开放/);
    assert.deepEqual(seen,['client.status','machine.snapshot']);
    assert.equal(await readFile(join(directory,'discovery.json'),'utf8'),discovery);
    assert.equal(stderr,'');
  } finally {child.stdin.end();await new Promise(resolve=>child.once('exit',resolve));reader.close();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(directory,{recursive:true,force:true});}
});

function fixture(methods?:string[], failure='不支持的 Agent 管理操作') {
  const calls:string[]=[], execs:string[]=[];
  const service=new LinuxWorkspaceService({get:()=>({})} as any,'unused');
  (service as any).bridge=async()=>({request:async(call:any)=>{calls.push(call.method);if(call.method==='client.status')return{methods,agentVersion:methods?'0.8.9':undefined};throw Error(failure);}});
  service.jobs.exec=(async(_:string,command:string)=>{execs.push(command);return JSON.stringify({platform:'linux',hostname:'ssh-target',at:Date.now(),cpu:[{model:'real-probe'}],memory:{total:1024},source:'ssh'});}) as any;
  return{service,calls,execs};
}
test('old daemon machine read uses real SSH collector; unsupported statuses do not break remaining market',async()=>{
  const {service,calls,execs}=fixture();
  assert.equal((await service.call('s',{method:'machine.snapshot',params:{}}) as any).source,'ssh');
  await service.call('s',{method:'machine.snapshot'});
  assert.equal(calls.filter(c=>c==='machine.snapshot').length,1);
  assert.equal(execs.length,2);
  assert.match(execs[0],/runtime\/bin\/node/);
  assert.doesNotMatch(execs[0],/sudo |kill |restart|discovery|identity|vault/);
  assert.equal((await service.call('s',{method:'coding.status'}) as any).supported,false);
  await assert.rejects(service.call('s',{method:'applications.install',params:{id:randomUUID(),confirm:true}}),/暂未提供/);
  assert.equal(calls.filter(c=>c==='applications.install').length,1,'mutation is never replayed');
});
test('negotiated missing methods skip rejected dispatch, permissions and unknown outcomes never fall back',async()=>{
  const negotiated=fixture(['client.status']);
  await negotiated.service.call('s',{method:'machine.snapshot'});
  assert.deepEqual(negotiated.calls,['client.status']);
  for(const failure of ['未授权远程管理','CAgent 操作超时；未重放','Connection closed','未知可视化操作']){
    const {service,calls,execs}=fixture(undefined,failure);
    await assert.rejects(service.call('s',{method:'machine.snapshot'}));
    assert.equal(execs.length,0);assert.equal(calls.filter(c=>c==='machine.snapshot').length,1);
  }
  assert.equal(isUnsupportedAgentMethod('不支持的 Agent 管理操作'),true);
  assert.equal(isUnsupportedAgentMethod('未知可视化操作'),false);
});
test('fallback validates read params and retains SSH method restriction',async()=>{
  const {service,execs}=fixture(['client.status']);
  await assert.rejects(service.call('s',{method:'machine.snapshot',params:{command:'id'}}),/参数无效/);
  await assert.rejects(service.call('s',{method:'client.access'}),/未在 SSH 工作区开放/);
  assert.equal(execs.length,0);
});
test('real Linux compatibility collection reports actual host without an Agent service', {skip:process.platform!=='linux'},async()=>{
  const {stdout}=await promisify(execFile)(process.execPath,['-e',linuxMachineSnapshotSource],{timeout:15000,maxBuffer:2*1024*1024});
  const value=JSON.parse(stdout),os=await import('node:os');
  assert.equal(value.hostname,os.hostname());assert.equal(value.platform,'linux');assert.equal(value.source,'ssh');
  assert(value.memory.total>0);assert(value.cpu.length>0);assert(value.disks||value.errors.disks);assert(value.processes.split('\n').length<=32);
});
test('existing SSH application plans retain target, single explicit install and no automatic privilege escalation',async()=>{
  const calls:any[]=[],jobs={exec:async(session:string)=>{calls.push(['inspect',session]);return 'Linux\nx86_64\n0';},start:(session:string,label:string,command:string)=>{calls.push(['start',session,command]);return{id:randomUUID(),sessionId:session,label};}};
  const apps=new ApplicationService(jobs as any),plan=await apps.plan('verified-ssh',{app:'nginx',version:'3.12',name:'unused'});
  assert.equal(calls.filter(c=>c[0]==='start').length,0);
  assert.doesNotMatch(plan.command,/sudo|cagent|pkill/);
  assert.throws(()=>apps.install(plan.id,'other-target'),/another session/);
  apps.install(plan.id,'verified-ssh');assert.equal(calls.filter(c=>c[0]==='start').length,1);
  assert.throws(()=>apps.install(plan.id,'verified-ssh'),/expired/);
});
