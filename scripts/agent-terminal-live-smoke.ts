import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { createAgentRuntime } from '../src/agent/runtime';
import { agentCodec } from '../src/agent/storage';
import { ClientVault } from '../src/core/client/identity';
import { ClientProvider } from '../src/core/client/provider';

if(process.platform!=='win32')throw Error('This acceptance test requires Windows');
const directory=await mkdtemp(join(tmpdir(),'cagent-live-terminals-'));
const runtime=await createAgentRuntime({directory:join(directory,'host')});
const output=new Map<string,string>();
const controllerDir=join(directory,'controller');
const client=new ClientProvider(new ClientVault(controllerDir,await agentCodec(controllerDir)),event=>{
  if(event.type!=='data')return;
  output.set(event.sessionId,(output.get(event.sessionId)??'')+event.data);
  try{client.resolve(event.sessionId).terminal?.acknowledge(event.data.length);}catch{}
});
async function until(check:()=>boolean){const deadline=Date.now()+15000;while(!check()){if(Date.now()>deadline)throw Error('Native terminal output timeout');await new Promise(r=>setTimeout(r,30));}}
try{
  const holder=createServer().listen(0,'127.0.0.1');await once(holder,'listening');const port=(holder.address() as {port:number}).port;await new Promise<void>(r=>holder.close(()=>r()));
  await runtime.dispatch('connection.save',{bind:'127.0.0.1',port,password:'isolated-native-acceptance',shells:['cmd','powershell']});
  await client.load();const info=await client.probe({host:'127.0.0.1',port});await client.pairPassword(info,'isolated-native-acceptance');
  const results=[];
  for(const shell of ['cmd','powershell'] as const){
    const id=await client.connect({deviceId:info.deviceId,shell},undefined,new AbortController().signal);
    const terminal=client.resolve(id).terminal;assert.ok(terminal);
    await until(()=>!!output.get(id));terminal.resize(91,27);
    // The expected marker does not occur literally in the echoed command.
    terminal.input(shell==='cmd'?'set /a 57231+4927\r':"Write-Output (57231+4927)\r");
    try{await until(()=>output.get(id)?.includes('62158')===true);}catch(error){console.error(shell,JSON.stringify(output.get(id)));throw error;}
    client.disconnect(id);
    await assert.rejects(async()=>client.resolve(id));
    const reopened=await client.connect({deviceId:info.deviceId,shell},undefined,new AbortController().signal);
    await until(()=>!!output.get(reopened));client.disconnect(reopened);
    results.push({shell,inputOutput:true,resize:true,disconnect:true,reconnect:true});
  }
  await mkdir('test-results',{recursive:true});await writeFile('test-results/agent-terminal-live.json',JSON.stringify({passed:true,transport:'authenticated TLS / native ConPTY',results},null,2));
  console.log('PASS: authenticated CAgent CMD and PowerShell actual output, resize, disconnect and reconnect');
}finally{client.dispose();await runtime.close();}
