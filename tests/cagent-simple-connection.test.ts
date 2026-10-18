import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {createAgentRuntime} from '../src/agent/runtime';
import {ClientProvider} from '../src/core/client/provider';
import {ClientVault} from '../src/core/client/identity';
import {agentCodec} from '../src/agent/storage';
test('simple connection persists a viewable password, permits authenticated remote configuration and resumes its saved listener', {timeout:45000},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'cagent-simple-'));
 const desktopExecutable=join(directory,'cagent-desktop.exe');await writeFile(desktopExecutable,'non-executable test fixture');
 let runtime=await createAgentRuntime({directory,desktopExecutable});const client=new ClientProvider(new ClientVault(join(directory,'viewer'),await agentCodec(join(directory,'viewer'))),()=>{});
 try{
  const holder=createServer().listen(0,'127.0.0.1');await once(holder,'listening');const port=(holder.address() as any).port;await new Promise<void>(r=>holder.close(()=>r()));
  assert.equal((await runtime.dispatch('assistant.settings',{}) as any).model,'');
  await assert.rejects(runtime.dispatch('connection.settings',{},undefined,false,'not-a-peer'),/未授权/);
  await runtime.dispatch('connection.save',{bind:'0.0.0.0',port,password:'123456',advertisedHost:'127.0.0.1',advertisedPort:51919});
  const settings=await runtime.dispatch('connection.settings',{}) as any;assert.equal(settings.password,'123456');assert.equal(settings.allowManage,true);assert.equal(settings.allowHttp,true);assert.equal(settings.allowHosting,true);assert.equal(settings.allowRelay,true);
  const assistant=await runtime.dispatch('assistant.settings',{}) as any;assert.equal(assistant.commands,true);assert.equal(assistant.review,false);assert.deepEqual(assistant.delegates,['*']);
  const info=JSON.parse(await runtime.dispatch('client.info',{host:'127.0.0.1'}) as string);assert.equal(info.port,51919);assert.equal(info.password,undefined);assert.equal(settings.bind,'0.0.0.0');assert.equal(settings.port,port);assert.equal(settings.advertisedPort,51919);
  if(process.platform==='win32'&&process.arch==='x64'){const desktop=await runtime.dispatch('desktop.status',{}) as any;assert.equal(desktop.config.udpPort,port);assert.equal(desktop.config.publicUdpPort,51919);assert.equal(desktop.config.publicTcpPort,51919);}
  await client.load();const device=await client.pairPassword(await client.probe({host:'127.0.0.1',port}),'123456');
  const remote=await client.call(device.deviceId,{method:'connection.settings'});assert.equal((remote as any).password,'123456');
  await client.call(device.deviceId,{method:'assistant.configure',params:{endpoint:'https://example.com/v1/chat/completions',model:'',commands:false,review:true,delegates:[]}});
  assert.equal((await runtime.dispatch('assistant.settings',{}) as any).commands,false);
  const selected=settings.allowedShells.slice(0,1);
  const changed=await client.call(device.deviceId,{method:'connection.save',params:{bind:'0.0.0.0',port,password:'123456',advertisedHost:'127.0.0.1',advertisedPort:443,shells:selected,allowHttp:false}}) as any;
  assert.equal(changed.disconnects,true);
  for(let n=0;n<100;n++){await new Promise(r=>setTimeout(r,50));if(runtime.server.status().running&&JSON.stringify(runtime.server.status().allowedShells)===JSON.stringify(selected))break;}
  assert.deepEqual(runtime.server.status().allowedShells,selected);
  client.dispose();await runtime.close();runtime=await createAgentRuntime({directory,desktopExecutable});assert.equal(runtime.server.status().running,true);
  assert.equal(runtime.server.status().deviceId,device.deviceId);
  await client.load();
  assert.equal((await client.call(device.deviceId,{method:'connection.settings'}) as any).password,'123456');
  assert.equal((await runtime.dispatch('connection.settings',{}) as any).password,'123456');
  assert.equal((await runtime.dispatch('assistant.settings',{}) as any).commands,false);assert.equal(runtime.server.status().advertisedPort,443);assert.equal(JSON.parse(await runtime.dispatch('client.info',{host:'127.0.0.1'}) as string).port,443);
  await assert.rejects(runtime.dispatch('connection.save',{bind:'0.0.0.0',port,password:'123456',advertisedPort:0}));assert.equal(runtime.server.status().running,true);
  await runtime.dispatch('connection.save',{bind:'0.0.0.0',port,password:'123456'});assert.equal(JSON.parse(await runtime.dispatch('client.info',{host:'127.0.0.1'}) as string).port,port);
  assert.equal(runtime.server.status().allowHttp,false);
  await runtime.dispatch('client.stop',{});await runtime.close();runtime=await createAgentRuntime({directory,desktopExecutable});assert.equal(runtime.server.status().running,false);
 }finally{client.dispose();await runtime.close();await rm(directory,{recursive:true,force:true,maxRetries:5})}
});


