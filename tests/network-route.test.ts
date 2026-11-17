import { test } from 'node:test';
import assert from 'node:assert/strict';
import { networkRouteSchema } from '../src/shared/network-route';
test('network route accepts one explicit endpoint and rejects bypass or credential injection', () => {
  assert.deepEqual(networkRouteSchema.parse({ mode: 'proxy', url: 'http://localhost:7890/' }), { mode: 'proxy', url: 'http://localhost:7890' });
  assert.equal(networkRouteSchema.parse({ mode: 'proxy', url: 'http://localhost:80' }).mode, 'proxy');
  for (const url of ['http://user:secret@localhost:80', 'http://localhost:80/path', 'http://localhost:80?bypass=*', 'socks5://localhost', 'http://localhost:80;direct://', 'file:///x']) {
    assert.throws(() => networkRouteSchema.parse({ mode: 'proxy', url }));
  }
  assert.throws(() => networkRouteSchema.parse({ mode: 'direct', proxy: '*' }));
});

import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ApplicationNetworkRoute} from '../src/desktop/network-route';
test('account route restore preserves chosen unavailable exit without connecting or fallback',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'cshell-route-'));
 const codec={encryptPrivate:async(s:string)=>s,decryptPrivate:async(s:string)=>s};
 const route=new ApplicationNetworkRoute(dir,codec as any);let connects=0;
 route.machine={list:async()=>[],proxy:async()=>{connects++;throw Error('offline')}};
 const chosen={mode:'machine' as const,id:'88cf3f77-74f1-4201-9920-aa7c8b97d173'};
 try{await route.cloudImport(chosen);assert.equal(connects,0);assert.deepEqual(route.cloudExport(),chosen);
 const loaded=new ApplicationNetworkRoute(dir,codec as any);await loaded.load();assert.deepEqual(loaded.cloudExport(),chosen);
 await assert.rejects(route.fetch('https://example.invalid'),/offline/);assert.equal(connects,1);await loaded.close();
 }finally{await route.close();await rm(dir,{recursive:true,force:true});}
});
test('cloud local exits never overwrite device selection and fresh device stays system',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'cshell-route-local-'));const codec={encryptPrivate:async(s:string)=>s,decryptPrivate:async(s:string)=>s};
 const route=new ApplicationNetworkRoute(dir,codec as any);
 try {await route.load();for(const value of [{mode:'direct'},{mode:'proxy',url:'http://127.0.0.1:7897'},{mode:'system'}]){await route.cloudImport(value);assert.deepEqual(route.cloudExport(),{mode:'system'});}
 await route.save({mode:'direct'});await route.cloudImport({mode:'system'});assert.deepEqual(route.cloudExport(),{mode:'direct'});
 const restarted=new ApplicationNetworkRoute(dir,codec as any);await restarted.load();await restarted.cloudImport({mode:'machine',id:'88cf3f77-74f1-4201-9920-aa7c8b97d173'});assert.deepEqual(restarted.cloudExport(),{mode:'direct'});await restarted.close();
 }finally{await route.close();await rm(dir,{recursive:true,force:true});}
});
test('failed cloud transaction restores fresh default without persisting a foreign route',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'cshell-route-rollback-'));const codec={encryptPrivate:async(s:string)=>s,decryptPrivate:async(s:string)=>s};const route=new ApplicationNetworkRoute(dir,codec as any);
 try{await route.load();const checkpoint=route.cloudCheckpoint();await route.cloudImport({mode:'machine',id:'88cf3f77-74f1-4201-9920-aa7c8b97d173'});await route.cloudRestore(checkpoint);const restarted=new ApplicationNetworkRoute(dir,codec as any);await restarted.load();assert.deepEqual(restarted.cloudCheckpoint(),{route:{mode:'system'},saved:false});await restarted.close();}finally{await route.close();await rm(dir,{recursive:true,force:true});}
});

test('Responses does not replay a model request or use DIRECT after proxy rejection', async () => {
  const {createServer} = await import('node:http');
  const proxy = createServer();
  let connects = 0;
  proxy.on('connect', (request, socket) => {
    connects++;
    assert.equal(request.url, 'api.openai.com:443');
    assert.equal(request.headers.authorization, undefined);
    socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
  });
  await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
  const route = new ApplicationNetworkRoute('.', {} as any);
  Object.assign(route, {current: {
    async resolveProxy() { return 'PROXY 127.0.0.1:' + (proxy.address() as {port:number}).port + '; DIRECT'; },
    fetch() { throw Error('unexpected fallback'); },
    closeAllConnections() {},
  }});
  try {
    await assert.rejects(route.fetch('https://api.openai.com/v1/responses', {
      method:'POST', headers:{Authorization:'Bearer example'}, body:'{}',
    }), /代理隧道连接失败/);
    assert.equal(connects, 1);
  } finally {
    await route.close();
    await new Promise<void>(resolve => proxy.close(() => resolve()));
  }
});
