import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {DesktopLooks} from '../src/core/desktop-looks';import {defaultDesktopLook} from '../src/shared/desktop-look';import {mergeCloud} from '../src/core/cloud-merge';
import {planAccountImport} from '../src/core/account-import';
const codec={encryptPrivate:async(v:string)=>Buffer.from(v).toString('base64'),decryptPrivate:async(v:string)=>Buffer.from(v,'base64').toString()};
const blue={...defaultDesktopLook,name:'蓝色',theme:'dark' as const};
async function fixture(fn:(s:DesktopLooks,dir:string)=>Promise<void>){const dir=await mkdtemp(join(tmpdir(),'cshell-look-'));try{const s=new DesktopLooks(dir,codec);await s.load();await fn(s,dir);}finally{await rm(dir,{recursive:true,force:true});}}
test('desktop looks persist offline, migrate only nondefault current-profile values, cloud wins and reset leaves tombstone',()=>fixture(async(s,dir)=>{
 assert.equal(await s.get('a',defaultDesktopLook),null);assert.equal(await s.cloudExport(),undefined);
 await s.get('a',blue);await s.get('a',{...blue,name:'stale'});assert.equal((await s.get('a'))?.name,'蓝色');
 await s.save('a',null);assert.equal(await s.get('a',blue),null);assert.equal((await s.cloudExport())!.looks.a,null);
 const reload=new DesktopLooks(dir,codec);await reload.load();assert.equal(await reload.get('a',blue),null);
 const other=await mkdtemp(join(tmpdir(),'cshell-other-'));try{const account=new DesktopLooks(other,codec);await account.load();assert.equal(await account.cloudExport(),undefined);}finally{await rm(other,{recursive:true,force:true});}
 assert.ok(!(await readFile(join(dir,'desktop-looks.enc'),'utf8')).includes('looks'));
}));
test('desktop cloud export/import verifies image content/hash, rejects unknown fields and can rollback',()=>fixture(async(s)=>{
 const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aenUAAAAASUVORK5CYII=';
 await s.save('a',{...blue,image});const original=(await s.cloudExport())!;assert.equal(Object.keys(original.images).length,1);
 await s.cloudImport({looks:{a:null},images:{}});await s.cloudImport(original);assert.equal((await s.get('a'))?.image,image);
 assert.throws(()=>s.cloudValidate({...original,windows:[]}));
 assert.throws(()=>s.cloudValidate({looks:original.looks,images:{}}));
 await assert.rejects(s.save('a',{...blue,image:'data:image/png;base64,SGVsbG8gd29ybGQh'}));
 const key=Object.keys(original.images)[0];assert.throws(()=>s.cloudValidate({...original,images:{[key.replace(/^./,key[0]==='0'?'1':'0')]:image}}));
 await assert.rejects(s.save('../escape',blue));await assert.rejects(s.save('a',{...blue,permission:true}));
 assert.equal((await s.get('a'))?.name,'蓝色');
}));
test('optional segment omission preserves local values; rollback omission clears; unused images are collected',()=>fixture(async(s)=>{
 const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aenUAAAAASUVORK5CYII=';
 assert.equal(await s.cloudExport(),undefined);
 await s.save('a',{...blue,image});await s.save('b',{...blue,image});
 await s.save('a',blue);assert.equal(Object.keys((await s.cloudExport())!.images).length,1);
 await s.cloudImport(undefined);assert.equal((await s.get('b'))?.image,image);
 await s.save('b',null);assert.deepEqual((await s.cloudExport())!.images,{});assert.equal((await s.cloudExport())!.looks.b,null);
 await s.cloudImport(undefined,true);assert.equal(await s.cloudExport(),undefined);
}));
test('desktop cloud merge combines different machines and reset tombstones without reviving old look',()=>fixture(async(s)=>{
 await s.save('a',blue);const base=(await s.cloudExport())!;const local=structuredClone(base),remote=structuredClone(base);
 local.looks.a=null;remote.looks.b=blue;
 const merged=mergeCloud(base,local,remote,['desktopLooks']);await s.cloudImport(merged);
 assert.equal(await s.get('a',blue),null);assert.equal((await s.get('b'))?.name,'蓝色');
}));
test('first optional desktop segment merges independent machines; legacy omission keeps local section',()=>{
 const local={desktopLooks:{looks:{a:blue},images:{}}},remote={desktopLooks:{looks:{b:blue},images:{}}};
 assert.deepEqual(Object.keys(mergeCloud({},local,remote).desktopLooks.looks).sort(),['a','b']);
 assert.deepEqual(mergeCloud({},local,{}),local);
});
test('cross-device image collection retains bytes referenced by an independently added look',()=>fixture(async(s)=>{
 const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aenUAAAAASUVORK5CYII=';
 await s.save('a',{...blue,image});const base=(await s.cloudExport())!;
 await s.save('a',null);const local=(await s.cloudExport())!;const remote=structuredClone(base);remote.looks.b=remote.looks.a;
 const merged=mergeCloud(base,local,remote,['desktopLooks']);await s.cloudImport(merged);assert.equal(await s.get('a'),null);assert.equal((await s.get('b'))?.image,image);
}));
test('source look import requires settings, resolves per-machine tombstones, and absent source preserves account',()=>{
 const empty=()=>({format:1,store:{profiles:[],groups:[],presets:[],monitorViews:[],secrets:{},hosts:{},preferences:{}},ai:{providers:[],habits:[]},devices:[],http:[],assets:{}});
 const account={...empty(),desktopLooks:{looks:{a:blue},images:{}}},source={...empty(),desktopLooks:{looks:{a:null,b:blue},images:{}}};
 assert.deepEqual(planAccountImport(account,source,{settings:false,choices:{}}).value.desktopLooks,account.desktopLooks);
 const pending=planAccountImport(account,source,{settings:true,choices:{}});assert.equal(pending.unresolved[0]?.id,'desktop-look/a');
 const applied=planAccountImport(account,source,{settings:true,choices:{'desktop-look/a':'source'}}).value.desktopLooks as any;assert.equal(applied.looks.a,null);assert.equal(applied.looks.b.name,'蓝色');
 assert.deepEqual(planAccountImport(account,empty(),{settings:true,choices:{}}).value.desktopLooks,account.desktopLooks);
});

