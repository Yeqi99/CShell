import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {TavilyExtension} from '../src/extensions/tavily/service';

test('Tavily portable accounts re-encrypt for the destination and never transfer billing consent or enable tools',async()=>{
 const root=await mkdtemp(join(tmpdir(),'tavily-cloud-'));
 let calls=0;
 const host=(name:string)=>({directory:join(root,name),enabled:()=>false,
  encrypt:async(s:string)=>name+':'+Buffer.from(s).toString('base64'),
  decrypt:async(s:string)=>{assert(s.startsWith(name+':'));return Buffer.from(s.slice(name.length+1),'base64').toString();}});
 const network:typeof fetch=async()=>{calls++;throw Error('Cloud transfer must not make a search request');};
 try{
  const data={accounts:[{id:randomUUID(),name:'Search account',key:'private-tavily-key',enabled:false}]};
  const source=host('source');await mkdir(source.directory);await writeFile(join(source.directory,'tavily.enc'),await source.encrypt(JSON.stringify({...data,allowPaygo:true})));
  const a=new TavilyExtension(source,network);await a.load();assert.deepEqual(await a.cloudExport(),data);
  const b=new TavilyExtension(host('target'),network);await b.load();await b.cloudImport(await a.cloudExport());
  const raw=await readFile(join(root,'target','tavily.enc'),'utf8');assert(!raw.includes('private-tavily-key'));
  const local=JSON.parse(await host('target').decrypt(raw));assert.equal(local.allowPaygo,false);
  assert.deepEqual(await b.cloudExport(),data);assert.deepEqual(b.tools(),[]);assert.equal(calls,0);
  const reloaded=new TavilyExtension(host('target'),network);await reloaded.load();assert.deepEqual(await reloaded.cloudExport(),data);
  await reloaded.cloudImport(undefined);assert.deepEqual(await reloaded.cloudExport(),data);
  await assert.rejects(reloaded.cloudImport({...data,allowPaygo:true}));
  await assert.rejects(reloaded.cloudImport({accounts:[...data.accounts,...data.accounts]}),/重复/);
  await assert.rejects(reloaded.cloudImport({accounts:[{...data.accounts[0],key:''}]}));
  assert.deepEqual(await reloaded.cloudExport(),data);
  // Existing explicit local billing consent is neither exported nor reset by a restore.
  await a.cloudImport({accounts:[]});const sourceSaved=JSON.parse(await source.decrypt(await readFile(join(source.directory,'tavily.enc'),'utf8')));assert.equal(sourceSaved.allowPaygo,true);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('failed Tavily destination encryption leaves persisted accounts and in-memory state unchanged',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'tavily-cloud-fail-'));let fail=false;
 const host={directory,enabled:()=>false,encrypt:async(s:string)=>{if(fail)throw Error('fixture storage failure');return Buffer.from(s).toString('base64');},decrypt:async(s:string)=>Buffer.from(s,'base64').toString()};
 try{
  const service=new TavilyExtension(host);await service.load();const data={accounts:[{id:randomUUID(),name:'Existing',key:'existing-test-key',enabled:true}]};await service.cloudImport(data);
  const before=await readFile(join(directory,'tavily.enc'),'utf8');fail=true;await assert.rejects(service.cloudImport({accounts:[]}),/storage failure/);
  assert.equal(await readFile(join(directory,'tavily.enc'),'utf8'),before);fail=false;await service.cloudImport(undefined);
  const reloaded=new TavilyExtension(host);await reloaded.load();assert.deepEqual(await reloaded.cloudExport(),data);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('unused Tavily omits its segment while deletion tombstones survive reload and old snapshots',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'tavily-cloud-empty-'));
 const host={directory,enabled:()=>true,encrypt:async(s:string)=>Buffer.from(s).toString('base64'),decrypt:async(s:string)=>Buffer.from(s,'base64').toString()};
 try{
  const service=new TavilyExtension(host);await service.load();assert.equal(await service.cloudExport(),undefined);
  await service.cloudImport(undefined);assert.equal(await service.cloudExport(),undefined);
  const id=randomUUID();await service.cloudImport({accounts:[{id,name:'Delete me',key:'test-delete-key',enabled:false}]});
  await service.call('remove',{id});assert.deepEqual(await service.cloudExport(),{accounts:[]});
  const reloaded=new TavilyExtension(host);await reloaded.load();await reloaded.cloudImport(undefined);assert.deepEqual(await reloaded.cloudExport(),{accounts:[]});
  const otherHost={...host,directory:join(directory,'other')};const other=new TavilyExtension(otherHost);await other.load();await other.cloudImport(await reloaded.cloudExport());assert.deepEqual(await other.cloudExport(),{accounts:[]});
  const otherReloaded=new TavilyExtension(otherHost);await otherReloaded.load();assert.deepEqual(await otherReloaded.cloudExport(),{accounts:[]});
  await otherReloaded.cloudImport(undefined,true);assert.equal(await otherReloaded.cloudExport(),undefined);
  const rolledBack=new TavilyExtension(otherHost);await rolledBack.load();assert.equal(await rolledBack.cloudExport(),undefined);
 }finally{await rm(directory,{recursive:true,force:true});}
});
