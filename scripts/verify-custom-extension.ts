import {mkdtemp,rm,writeFile} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readCustomExtension,installCustomExtension,loadPrivateWechat} from '../src/core/custom-extensions';
const pack=await readCustomExtension(process.argv[2]);assert.equal(pack.trusted,true);
const root=await mkdtemp(join(tmpdir(),'verified-private-extension-'));
try{
 await installCustomExtension(pack,root);const loaded=await loadPrivateWechat(root);assert(loaded);assert.equal(typeof loaded.module.WechatService,'function');
 const service=new loaded.module.WechatService(join(root,'data'),{plugins:()=>[]},{python:join(loaded.runtime,'python.exe'),local:true});await service.load();assert.equal(service.tools().length,0);assert.equal(service.configured(),false);
 await writeFile(join(loaded.runtime,'python.exe'),'tampered');await assert.rejects(loadPrivateWechat(root),/被修改/);
}finally{await rm(root,{recursive:true,force:true});}
for(const entry of ['src/desktop/main.ts','src/agent/cli.ts']){
 const result=await build({entryPoints:[entry],bundle:true,platform:'node',format:'cjs',write:false,metafile:true,external:['electron','node-pty','ssh2','@modelcontextprotocol/sdk','selfsigned']});
 assert(!Object.keys(result.metafile!.inputs).some(p=>/src\/(core\/wechat(?:-subscriptions)?|agent\/wechat-capability)\.ts$/.test(p.replaceAll('\\','/'))),'WeChat implementation must not be bundled in '+entry);
}
console.log('PASS real signed private package, isolated install, default-denied activation, tamper rejection, desktop/CAgent bundle separation');
