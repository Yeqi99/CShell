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
