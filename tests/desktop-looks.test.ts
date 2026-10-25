import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {DesktopLooks} from '../src/core/desktop-looks';import {defaultDesktopLook} from '../src/shared/desktop-look';

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
