import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {clearGuestCache} from '../src/core/guest-cache';
test('legacy guest root clears only documented files; account, identity and cloud state remain',async()=>{
 const root=await mkdtemp(join(tmpdir(),'guest-clear-'));try{
 const account=join(root,'account-profiles','account');await mkdir(account,{recursive:true});await mkdir(join(root,'client-controller'));await mkdir(join(root,'Local Storage'));
 for(const name of ['config.json','ai.enc','opencode.enc','client-controller/devices.enc','Local Storage/cache','account-profile.json','cloud.enc','Local State','client-controller/identity.enc','account-profiles/account/config.json'])await writeFile(join(root,name),'fixture');
 await clearGuestCache(root,account);
 for(const name of ['config.json','ai.enc','opencode.enc','client-controller/devices.enc','Local Storage'])await assert.rejects(access(join(root,name)));
 for(const name of ['account-profile.json','cloud.enc','Local State','client-controller/identity.enc','account-profiles/account/config.json'])assert.equal(await readFile(join(root,name),'utf8'),'fixture');
 await assert.rejects(clearGuestCache(account,account),/正在使用/);
 }finally{await rm(root,{recursive:true,force:true});}
});
