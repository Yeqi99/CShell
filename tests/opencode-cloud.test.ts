import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {OpenCodeExtension} from '../src/extensions/opencode/service';
test('OpenCode account credentials round trip through backend cloud adapter without enabling extension',async()=>{
 const root=await mkdtemp(join(tmpdir(),'opencode-cloud-'));
 const host=(name:string)=>({directory:join(root,name),enabled:()=>false,encrypt:async(s:string)=>Buffer.from(s).toString('base64'),decrypt:async(s:string)=>Buffer.from(s,'base64').toString(),saveProvider:async()=>{},open:async()=>{}});
 try {const a=new OpenCodeExtension(host('a'));await a.load();const data={accounts:[{id:'default',name:'fixture',key:'private-test-key',refreshToken:'private-refresh',workspace:'wrk_test'}]};await a.cloudImport(data);const b=new OpenCodeExtension(host('b'));await b.load();await b.cloudImport(await a.cloudExport());assert.deepEqual(await b.cloudExport(),data);const reloaded=new OpenCodeExtension(host('b'));await reloaded.load();assert.deepEqual(await reloaded.cloudExport(),data);assert.equal((await readFile(join(root,'b/opencode.enc'),'utf8')).includes('private-test-key'),false);await assert.rejects(b.call('status'),/启用/);assert.throws(()=>b.cloudValidate({accounts:[...data.accounts,...data.accounts]}),/重复/);await assert.rejects(b.cloudImport({accounts:[{id:'default',name:'bad',key:''}]}));assert.deepEqual(await b.cloudExport(),data);}finally{await rm(root,{recursive:true,force:true});}
});
