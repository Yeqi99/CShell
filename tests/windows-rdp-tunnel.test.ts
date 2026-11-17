import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {connect, createServer, type Server} from 'node:net';
import {WindowsRdpTunnel} from '../src/agent/windows-rdp-tunnel';
import {ClientServer} from '../src/core/client/server';
import {ClientProvider} from '../src/core/client/provider';
import {ClientVault} from '../src/core/client/identity';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {z} from 'zod';
import type {ManagedProvider} from '../src/core/connections/manager';

async function listen(server:Server) {
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  const address=server.address();
  assert.ok(address&&typeof address==='object');
  return address.port;
}
test('RDP tunnel uses only the verified listener, proxies bytes, and closes when control is revoked',async()=>{
  let allowed=true,accepted=0;
  const target=createServer(s=>{accepted++;s.pipe(s);});
  const port=await listen(target);
  const tunnel=new WindowsRdpTunnel(async()=>({port,sha256:'pin'}),async(host,chosen)=>{assert.equal(host,'127.0.0.1');assert.equal(chosen,port);return 'pin';},async()=>true);
  const local=createServer(s=>{void tunnel.accept(s,()=>allowed);});
  const connection=connect(await listen(local),'127.0.0.1');
  try{
    const data=once(connection,'data');
    connection.write(Buffer.from([0,255,42]));
    assert.deepEqual((await data)[0],Buffer.from([0,255,42]));
    const closed=once(connection,'close');allowed=false;await closed;
    assert.equal(accepted,1);
  }finally{connection.destroy();local.close();target.close();}
});
test('paired client upgrades a dedicated mTLS channel, transfers bytes and aborts without opening a terminal',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'cagent-rdp-tls-'));
  const codec={encrypt:async(value:string)=>value,decrypt:async(value:string)=>value};
  const terminal:ManagedProvider={id:'test',version:'1',capabilities:[],configuration:z.any(),async connect(){throw Error('unexpected terminal');},disconnect(){},resolve(){throw Error('unexpected terminal');}};
  const endpoint=createServer(s=>s.pipe(s));
  const port=await listen(endpoint);
  const tunnel=new WindowsRdpTunnel(async()=>({port,sha256:'test-certificate'}),async()=> 'test-certificate',async()=>true);
  const server=new ClientServer(new ClientVault(join(directory,'server'),codec),terminal,{rdpStream:(socket,_owner,allowed)=>tunnel.accept(socket,allowed)});
  const client=new ClientProvider(new ClientVault(join(directory,'client'),codec),()=>{});
  try{
    await server.load();await client.load();
    await server.setAccess({password:'test-fixture-password',allowManage:true,shells:[]});
    const reserve=createServer();
    const agentPort=await listen(reserve);await new Promise<void>(resolve=>reserve.close(()=>resolve()));
    await server.start({bind:'127.0.0.1',port:agentPort});
    const info=await client.probe({host:'127.0.0.1',port:agentPort});
    const cancel=new AbortController();
    await assert.rejects(client.openRdpStream(info.deviceId,cancel.signal));
    await client.pairPassword(info,'test-fixture-password');
    const stream=await client.openRdpStream(info.deviceId,cancel.signal);
    const received=once(stream,'data');stream.resume();
    stream.write(Buffer.from('03000013','hex'));
    assert.deepEqual((await received)[0],Buffer.from('03000013','hex'));
    const closed=once(stream,'close');cancel.abort();await closed;
  }finally{client.dispose();await server.stop();endpoint.close();await rm(directory,{recursive:true,force:true});}
});
test('denial and a mismatched RDP cert never forward client data',async()=>{
  for(const allowed of [false,true]){
    let probes=0,accepted=0;
    const target=createServer(s=>{accepted++;s.destroy();});
    const port=await listen(target);
    const tunnel=new WindowsRdpTunnel(async()=>({port,sha256:'trusted'}),async()=>{probes++;return 'changed';});
    const local=createServer(s=>{void tunnel.accept(s,()=>allowed);});
    const connection=connect(await listen(local),'127.0.0.1');
    try{
      await once(connection,'close');
      assert.equal(accepted,0);assert.equal(probes,Number(allowed));
    }finally{connection.destroy();local.close();target.close();}
  }
});
test('a new process taking the listener port after preflight receives no caller bytes',async()=>{
  let received=0;
  const endpoint=createServer(s=>s.on('data',chunk=>{received+=chunk.length;}));
  const port=await listen(endpoint);
  const tunnel=new WindowsRdpTunnel(async()=>({port,sha256:'pin'}),async()=>'pin',async()=>false);
  const local=createServer(s=>{void tunnel.accept(s,()=>true);});
  const client=connect(await listen(local),'127.0.0.1');
  try{
    const closed=new Promise<void>(resolve=>client.once('close',resolve));
    client.on('error',(error:NodeJS.ErrnoException)=>assert.equal(error.code,'ECONNRESET'));client.write('must stay private');await closed;
    assert.equal(received,0);
  }finally{client.destroy();local.close();endpoint.close();}
});
