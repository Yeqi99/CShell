import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDesktopCapability} from '../src/agent/desktop-capability';
import type {ClientVault} from '../src/core/client/identity';
test('optional desktop package installation does not listen or authorize owners',{skip:process.platform!=='win32'||process.arch!=='x64'},async()=>{
 const prefix=join(tmpdir(),'cshell-desktop-package-');const root=await mkdtemp(prefix);const values=new Map<string,unknown>();
 const vault={read:async(key:string)=>values.get(key),write:async(key:string,value:unknown)=>{values.set(key,value);}} as unknown as Pick<ClientVault,'read'|'write'>;
 const exe=join(root,'cagent-desktop.exe');await writeFile(exe,'not executable: package lifecycle fixture');
 const capability=await createDesktopCapability({identity:'test',nativeExecutable:exe,vault,authorize:()=>true});
 try{assert.equal(capability.extraPackages.length,1);const {adapter}=capability.extraPackages[0];assert.equal((await adapter.inspect(root)).installed,true);
  assert.equal(capability.service.status('local').listening,false);
  await adapter.register!(root,['desktop.view']);assert.equal(capability.service.status('local').listening,false);assert.equal(capability.service.status('local').viewAllowed,true);
  await assert.rejects(capability.dispatch('desktop.configure',{enabled:false},'remote',false),/local administration/);
  await adapter.quiesce!();assert.equal((await capability.dispatch('desktop.status',{},'local',true) as {packageReady:boolean}).packageReady,false);
 }finally{await capability.shutdown();assert.ok(root.startsWith(prefix));await rm(root,{recursive:true,force:true});}
});
