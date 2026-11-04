import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ClientProvider} from '../src/core/client/provider';
import {ClientVault,createIdentity} from '../src/core/client/identity';
import {CagentCloud} from '../src/agent/cloud';
const codec={encrypt:async(s:string)=>s,decrypt:async(s:string)=>s};
test('explicit device address persists across vault reload and cloud serialization without changing identity or account grants',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'address-check-'));try{
 const identity=await createIdentity();const vault=new ClientVault(dir,codec);const p=new ClientProvider(vault,()=>{});
 await p.cloudImport([{protocol:1,deviceId:identity.id,name:'device',certificate:identity.certificate,host:'154.219.103.127',port:22444,accountManaged:true,accountPassword:'test-only'}]);
 await p.updateEndpoint(identity.id,{host:'p3.deviy.cn',port:53773});
 const loaded=new ClientProvider(vault,()=>{});await loaded.load();const d=loaded.cloudExport()[0];assert.equal(d.host,'p3.deviy.cn');assert.equal(d.port,53773);assert.equal(d.certificate,identity.certificate);assert.equal(d.accountManaged,true);assert.equal(d.accountPassword,'test-only');
 const roundtrip=JSON.parse(JSON.stringify(loaded.cloudExport()));await p.cloudImport(roundtrip);assert.equal(p.list()[0].host,'p3.deviy.cn');
 await assert.rejects(p.updateEndpoint(identity.id,{host:'bad/path',port:53773}));assert.equal(p.list()[0].host,'p3.deviy.cn');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('CAgent repeated registration keeps custom profile address instead of relay address',async()=>{
 const c=Object.create(CagentCloud.prototype) as any;
 c.ticking=false;c.lastEnroll=0;c.cached={devices:[{deviceId:'device',host:'old',port:24443}],store:{profiles:[{id:'device',host:'p3.deviy.cn',port:53773}],groups:[]}};
 c.hooks={enroll:async()=>({deviceId:'device',name:'test',accountPassword:'test'}),start:async()=>{},stop:async()=>{}};
 c.sync={status:()=>({email:'test'}),accountRequest:async(path:string)=>path==='/v1/account'?{membership:{active:true}}:path==='/v1/models'?{models:[]}:{endpoint:{host:'154.219.103.127',port:22444},relay:{host:'154.219.103.127',port:22444}},autoSync:async()=>{}};
 c.assistant={ensureOfficialModels:async()=>{}};
 for(let n=0;n<3;n++){c.lastEnroll=0;await c.runTick();c.cached=JSON.parse(JSON.stringify(c.cached));assert.equal(c.cached.devices[0].host,'p3.deviy.cn');assert.equal(c.cached.devices[0].port,53773);}
});
