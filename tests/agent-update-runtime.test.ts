import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {createAgentRuntime} from '../src/agent/runtime';import {AgentTerminalProvider} from '../src/core/agent-terminal';
test('update boot gates all new work until an authenticated local identity handshake releases it',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'cagent-update-gate-'));process.env.CSHELL_AGENT_UPDATE_COMMIT='a'.repeat(64);
 let runtime:Awaited<ReturnType<typeof createAgentRuntime>>|undefined;
 try{
  runtime=await createAgentRuntime({directory});assert.equal(process.env.CSHELL_AGENT_UPDATE_COMMIT,undefined);
  const status=await runtime.dispatch('client.status',{}) as any;assert.equal(status.updateProtocol,1);assert.equal(status.updatePendingCommit,true);assert.ok(status.methods.includes('machine.snapshot'));
  await assert.rejects(runtime.dispatch('machine.snapshot',{}),/完成更新/);
  await assert.rejects(runtime.dispatch('update.commit',{token:'a'.repeat(64)},undefined,false,'remote'),/只允许在本机/);
  await assert.rejects(runtime.dispatch('update.commit',{token:'b'.repeat(64)}),/不匹配/);
  const accepted=await runtime.dispatch('update.commit',{token:'a'.repeat(64)}) as any;assert.equal(accepted.deviceId,status.deviceId);assert.equal(accepted.committed,true);
  assert.equal((await runtime.dispatch('client.status',{}) as any).updatePendingCommit,false);
  assert.ok(await runtime.dispatch('agent.shells',{}));
  await assert.rejects(runtime.dispatch('update.commit',{token:'a'.repeat(64)}),/不匹配/);
 }finally{delete process.env.CSHELL_AGENT_UPDATE_COMMIT;await runtime?.close();await rm(directory,{recursive:true,force:true});}
});
test('terminal opening is activity before shell detection completes, and update admission rejects new execution',async()=>{
 let resolve!:()=>void;const delay=new Promise<void>(r=>{resolve=r;});const provider=new AgentTerminalProvider(()=>{},async()=>{await delay;return [];});
 const execution=provider.execute({shell:'sh',command:'true'},new AbortController().signal);assert.equal(provider.activity,1);
 provider.setUpdateGuard(()=>true);await assert.rejects(provider.execute({shell:'sh',command:'true'},new AbortController().signal),/完成更新/);assert.equal(provider.activity,1);
 resolve();await assert.rejects(execution,/未安装/);assert.equal(provider.activity,0);await provider.dispose();
});
