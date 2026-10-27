import {build} from 'esbuild';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {EventEmitter} from 'node:events';import {createRequire} from 'node:module';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),dir=await mkdtemp(join(tmpdir(),'update-lifecycle-'));
const app=Object.assign(new EventEmitter(),{getVersion:()=> '0.8.6',getPath:(name:string)=>name==='exe'?join(dir,'CShell.exe'):dir,quit:()=>{}}),window=new EventEmitter(),launched:any[]=[];
const pro=process.argv.includes('--pro');
const bytes=Buffer.from('never executed fixture'),name=(pro?'CShell-Pro-':'CShell-')+'0.8.7-win-x64.exe',base='https://shell.canp.ai/downloads/'+(pro?'pro':'opensource')+'/v0.8.7/';
const assets=[{name,size:bytes.length},{name:'SHA256SUMS.txt',size:100}].map(a=>({...a,browser_download_url:base+a.name}));
const fixture={app,shell:{openExternal:()=>{throw Error('Unexpected navigation')}},net:{fetch:async(url:string)=>new Response(url.endsWith('releases.json')?JSON.stringify([{tag_name:'v0.8.7',assets}]):url.endsWith('SHA256SUMS.txt')?createHash('sha256').update(bytes).digest('hex')+'  '+name:bytes)},spawn:(...args:any[])=>{launched.push(args);return Object.assign(new EventEmitter(),{unref(){}})}};
(globalThis as any).updateFixture=fixture;
const scheduled = new Map<object, { callback: () => void; delay: number }>();
const schedule = (callback: () => void, delay: number) => {
 const timer = { unref() {} }; scheduled.set(timer, { callback, delay }); return timer;
};
Object.assign(fixture, { setTimeout: schedule, setInterval: schedule,
 clearTimeout: (timer: object) => scheduled.delete(timer), clearInterval: (timer: object) => scheduled.delete(timer) });
try{
 await build({entryPoints:['src/desktop/updates.ts'],outfile:join(dir,'updater.cjs'),bundle:true,platform:'node',format:'cjs',banner:{js:'const {setTimeout,setInterval,clearTimeout,clearInterval}=globalThis.updateFixture;'},define:{__CSHELL_PRO__:String(pro)},plugins:[{name:'isolated-platform',setup(b){b.onResolve({filter:/^(electron|node:child_process)$/},a=>({path:a.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='electron'?'module.exports=globalThis.updateFixture;':'module.exports={spawn:globalThis.updateFixture.spawn,execFile(){throw Error("Unexpected POSIX installer")}};',loader:'js'}));}}]});
 const handlers=new Map<string,Function>();require(join(dir,'updater.cjs')).registerUpdateHandlers((n:string,f:Function)=>handlers.set(n,f),window);
 const call=(name:string)=>handlers.get('update:'+name)!();
 // Electron emits before-quit before the window close guard can cancel exit.
 app.emit('before-quit'); window.emit('update-close-cancelled');
 assert.equal(scheduled.size,2,'cancelled exit must retain automatic update schedules');
 scheduled.forEach(timer=>{if(timer.delay===30000)timer.callback();});
 const deadline=Date.now()+5000;
 while((await call('state')).phase!=='ready' && Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal((await call('state')).phase,'ready','automatic check and verified download still run after cancelled exit');
 app.quit=()=>{app.emit('before-quit');window.emit('update-close-cancelled')};await call('install');
 assert.equal(launched.length,0); assert.equal(app.listenerCount('quit'),1,'cancelled install leaves only scheduler cleanup');
 assert.equal(scheduled.size,2,'cancelled install retains recurring updates');
 app.quit=()=>{app.emit('before-quit');app.emit('quit')};await call('install');assert.equal(launched.length,1);
 assert.deepEqual(launched[0][1],['/S','--force-run','/D='+dir]);assert.equal(launched[0][2].windowsHide,true);
 assert.equal(scheduled.size,0,'confirmed exit cleans up schedules');
 console.log('PASS cancellation removes pending installer; confirmed exit starts one installer at original directory');
}finally{app.emit('quit');delete (globalThis as any).updateFixture;await rm(dir,{recursive:true,force:true});}
