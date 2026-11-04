import test from 'node:test';
import {z} from 'zod';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ClientProvider} from '../src/core/client/provider';
import {ClientVault,createIdentity} from '../src/core/client/identity';
const codec={encrypt:async(s:string)=>s,decrypt:async(s:string)=>s};
test('explicit device address persists across vault reload without changing identity',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'address-check-'));try{
 const identity=await createIdentity();const vault=new ClientVault(dir,codec);const p=new ClientProvider(vault,()=>{});
 await vault.write('devices',[{protocol:1,deviceId:identity.id,name:'device',certificate:identity.certificate,host:'154.219.103.127',port:22444}]);await p.load();
 await p.updateEndpoint(identity.id,{host:'p3.deviy.cn',port:53773});
 const loaded=new ClientProvider(vault,()=>{});await loaded.load();const d=(await vault.read('devices',z.array(z.any())))![0];assert.equal(d.host,'p3.deviy.cn');assert.equal(d.port,53773);assert.equal(d.certificate,identity.certificate);

 await assert.rejects(p.updateEndpoint(identity.id,{host:'bad/path',port:53773}));assert.equal(p.list()[0].host,'p3.deviy.cn');
 }finally{await rm(dir,{recursive:true,force:true});}
});

