import {build} from 'esbuild';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {EventEmitter} from 'node:events';import {createRequire} from 'node:module';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),dir=await mkdtemp(join(tmpdir(),'update-lifecycle-'));
const app=Object.assign(new EventEmitter(),{getVersion:()=> '0.8.6',getPath:(name:string)=>name==='exe'?join(dir,'CShell.exe'):dir,quit:()=>{}}),window=new EventEmitter(),launched:any[]=[];
const bytes=Buffer.from('never executed fixture'),name='CShell-0.8.7-win-x64.exe',base='https://shell.canp.ai/downloads/opensource/v0.8.7/';
const assets=[{name,size:bytes.length},{name:'SHA256SUMS.txt',size:100}].map(a=>({...a,browser_download_url:base+a.name}));
const fixture={app,shell:{openExternal:()=>{throw Error('Unexpected navigation')}},net:{fetch:async(url:string)=>new Response(url.endsWith('releases.json')?JSON.stringify([{tag_name:'v0.8.7',assets}]):url.endsWith('SHA256SUMS.txt')?createHash('sha256').update(bytes).digest('hex')+'  '+name:bytes)},spawn:(...args:any[])=>{launched.push(args);return Object.assign(new EventEmitter(),{unref(){}})}};
(globalThis as any).updateFixture=fixture;
try{
 await build({entryPoints:['src/desktop/updates.ts'],outfile:join(dir,'updater.cjs'),bundle:true,platform:'node',format:'cjs',define:{__CSHELL_PRO__:'false'},plugins:[{name:'isolated-platform',setup(b){b.onResolve({filter:/^(electron|node:child_process)$/},a=>({path:a.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='electron'?'module.exports=globalThis.updateFixture;':'module.exports={spawn:globalThis.updateFixture.spawn,execFile(){throw Error("Unexpected POSIX installer")}};',loader:'js'}));}}]});
 const handlers=new Map<string,Function>();require(join(dir,'updater.cjs')).registerUpdateHandlers((n:string,f:Function)=>handlers.set(n,f),window);
 const call=(name:string)=>handlers.get('update:'+name)!();
 assert.equal((await call('check')).phase,'available');assert.equal((await call('download')).phase,'ready');
 app.quit=()=>{window.emit('update-close-cancelled')};await call('install');app.emit('quit');assert.equal(launched.length,0);
 app.quit=()=>{app.emit('before-quit');app.emit('quit')};await call('install');assert.equal(launched.length,1);
 assert.deepEqual(launched[0][1],['/S','--force-run','/D='+dir]);assert.equal(launched[0][2].windowsHide,true);
 console.log('PASS cancellation removes pending installer; confirmed exit starts one installer at original directory');
}finally{app.emit('before-quit');delete (globalThis as any).updateFixture;await rm(dir,{recursive:true,force:true});}
