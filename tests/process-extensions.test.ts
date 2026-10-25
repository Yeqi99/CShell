import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { capabilityDigest } from '../src/agent/capability-catalog';
import { ProcessCapabilityAdapter } from '../src/agent/process-capability';
import { agentCapabilityManifestSchema } from '../src/shared/agent-capability-packages';
import { parseCustomExtension, installCustomExtension, loadProcessExtensions } from '../src/core/custom-extensions';
import { ProcessExtensions } from '../src/core/process-extensions';
import { ClientVault } from '../src/core/client/identity';
import type { InstalledPlugin } from '../src/shared/plugins';

const source = `let raw='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>raw+=c);process.stdin.on('end',()=>{const r=JSON.parse(raw);const reply=result=>process.stdout.write(JSON.stringify({protocol:1,id:r.id,result}));switch(r.args.mode){case 'wait':require('node:fs').writeFileSync('invocation-ready.json',JSON.stringify({pid:process.pid}));setInterval(()=>{},1000);break;case 'overflow':process.stdout.write('x'.repeat(5000));break;case 'stderr':process.stderr.write('secret'.repeat(12000));break;case 'bad':reply({wrong:true});break;case 'wrong-id':process.stdout.write(JSON.stringify({protocol:1,id:'00000000-0000-4000-8000-000000000001',result:{value:'no'}}));break;case 'failure':process.stderr.write('SECRET_TOKEN');process.exitCode=1;break;default:reply({value:r.args.value||'ok',secret:process.env.CSHELL_SECRET_TEST||'',options:process.env.NODE_OPTIONS||''});}});`;
function manifest(code=source, patch: Record<string,unknown>={}) {
  return agentCapabilityManifestSchema.parse({protocol:1,id:'example.process',name:'Fixture',version:'1.0.0',license:'MIT',description:'Local test tool',source:{repository:'https://github.com/example/fixture',releaseTag:'v1',assetUrl:'https://github.com/example/fixture/releases/download/v1/fixture.cshellext'},compatibility:{platforms:['win32','linux','darwin'],architectures:['x64','arm64'],agentVersion:{min:'0.8.0',maxExclusive:'1.0.0'}},adapterId:'example.process',process:{protocol:'node-json-stdio-1',entry:'entry.cjs',timeoutMs:1000,maxOutputBytes:1024,maxConcurrency:1,...patch},files:[{path:'entry.cjs',bytes:Buffer.byteLength(code),sha256:capabilityDigest(code)}],permissions:['extension.execute'],tools:[{id:'echo',description:'Echo bounded JSON',inputSchema:{type:'object',properties:{mode:{type:'string'},value:{type:'string'}},additionalProperties:false},outputSchema:{type:'object',properties:{value:{type:'string'},secret:{type:'string'},options:{type:'string'}},required:['value'],additionalProperties:false},permissions:['extension.execute'],sideEffect:false}],events:[]});
}
function custom(code=source) { const capability=manifest(code); return parseCustomExtension(JSON.stringify({format:'cshell-extension-1',manifest:{protocol:1,id:capability.id,version:capability.version,name:'Fixture',description:'Fixture',publisher:'Test',provider:'process',permissions:['remote.execute'],capability},files:[{path:'entry.cjs',sha256:capabilityDigest(code),data:Buffer.from(code).toString('base64')}]})); }
async function fixture(patch:Record<string,unknown>={}) {
  const root=await mkdtemp(join(tmpdir(),'cshell-process-test-')),m=manifest(source,patch);await writeFile(join(root,'entry.cjs'),source);
  const adapter=new ProcessCapabilityAdapter(m);return {root,m,adapter,cleanup:async()=>{await adapter.stop();await rm(root,{recursive:true,force:true});}};
}
const signal=()=>new AbortController().signal;
async function startedPid(root:string){
  const deadline=Date.now()+10000;
  while(Date.now()<deadline){try{const {pid}=JSON.parse(await readFile(join(root,'invocation-ready.json'),'utf8'));assert(Number.isInteger(pid)&&pid>0);return pid as number;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}await new Promise(resolve=>setTimeout(resolve,25));}
  throw Error('Fixture child did not report startup');
}
async function assertExited(pid:number){
  for(let attempt=0;attempt<40;attempt++){try{process.kill(pid,0);}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')return;throw error;}await new Promise(resolve=>setTimeout(resolve,25));}
  assert.fail('Fixture child remained alive after invocation settled');
}

test('process manifests require declared JS entry, explicit execution permission and matching package hashes',()=>{
  const good=manifest();
  for(const changed of [{process:{...good.process,entry:'../bad.js'}},{process:{...good.process,entry:'missing.cjs'}},{tools:[{...good.tools[0],permissions:[]}]},{process:{...good.process,maxConcurrency:100}}])assert.throws(()=>agentCapabilityManifestSchema.parse({...good,...changed}));
  const pack=custom();assert.equal(pack.trusted,false);
  assert.throws(()=>parseCustomExtension(JSON.stringify({...pack.value,manifest:{...pack.value.manifest,capability:{...pack.value.manifest.capability,files:[]}}})));
});
test('unregistered and ungranted process cannot run; valid JSON round trip does not inherit host secrets',async()=>{
  const f=await fixture();try{
    await assert.rejects(f.adapter.invoke('echo',{},'local',signal()),/authorized/);
    await f.adapter.register(f.root,[]);await assert.rejects(f.adapter.invoke('echo',{},'local',signal()),/authorized/);
    await f.adapter.register(f.root,['extension.execute']);process.env.CSHELL_SECRET_TEST='must-not-leak';
    try{assert.deepEqual(await f.adapter.invoke('echo',{value:'hello'},'local',signal()),{value:'hello',secret:'',options:''});}finally{delete process.env.CSHELL_SECRET_TEST;}
    await assert.rejects(f.adapter.invoke('echo',{unexpected:true},'local',signal()));
    await assert.rejects(f.adapter.invoke('echo',{value:'x'.repeat(70000)},'local',signal()),/64 KiB/);
  }finally{await f.cleanup();}
});
test('stdout, stderr, output schema, response identity and error messages are bounded',async()=>{
  const f=await fixture();try{await f.adapter.register(f.root,['extension.execute']);
    for(const [mode,pattern] of [['overflow',/output limit/],['stderr',/diagnostic output/],['bad',/schema/],['wrong-id',/match/],['failure',/^Error: Extension process failed$/]] as const)await assert.rejects(f.adapter.invoke('echo',{mode},'local',signal()),pattern);
  }finally{await f.cleanup();}
});
test('timeout terminates child, frees slot and does not disable later valid calls',async()=>{
  // Real sanitized Node startup on Windows measured 264–553 ms. A 250 ms
  // budget tested OS startup speed rather than timeout cleanup or slot reuse.
  const f=await fixture({timeoutMs:2000});try{await f.adapter.register(f.root,['extension.execute']);const timedOut=assert.rejects(f.adapter.invoke('echo',{mode:'wait'},'local',signal()),/timed out/);const pid=await startedPid(f.root);await timedOut;await assertExited(pid);assert.equal((await f.adapter.invoke('echo',{},'local',signal()) as any).value,'ok');}finally{await f.cleanup();}
});
test('concurrency, explicit cancellation and revoke stop a running real child',async()=>{
  const f=await fixture({timeoutMs:10000});try{await f.adapter.register(f.root,['extension.execute']);
    const controller=new AbortController(),running=f.adapter.invoke('echo',{mode:'wait'},'local',controller.signal);const rejected=assert.rejects(running,/cancelled/);
    await assert.rejects(f.adapter.invoke('echo',{},'local',signal()),/concurrency/);const firstPid=await startedPid(f.root);controller.abort();await rejected;await assertExited(firstPid);await rm(join(f.root,'invocation-ready.json'));
    const next=f.adapter.invoke('echo',{mode:'wait'},'local',signal()),revoked=assert.rejects(next,/cancelled|authorization/);const secondPid=await startedPid(f.root);await f.adapter.quiesce();await revoked;await assertExited(secondPid);
    await assert.rejects(f.adapter.invoke('echo',{},'local',signal()),/authorized/);
  }finally{await f.cleanup();}
});
test('an already cancelled invocation never starts a child and frees its slot',async()=>{
  const f=await fixture();try{await f.adapter.register(f.root,['extension.execute']);const controller=new AbortController();controller.abort();await assert.rejects(f.adapter.invoke('echo',{mode:'wait'},'local',controller.signal),{name:'AbortError'});await assert.rejects(readFile(join(f.root,'invocation-ready.json')),{code:'ENOENT'});assert.equal((await f.adapter.invoke('echo',{},'local',signal()) as any).value,'ok');}finally{await f.cleanup();}
});
test('revalidates materialized files before each process invocation',async()=>{
  const f=await fixture();try{await f.adapter.register(f.root,['extension.execute']);await writeFile(join(f.root,'entry.cjs'),'throw Error("tampered")');await assert.rejects(f.adapter.invoke('echo',{},'local',signal()),/size|digest|changed/);}finally{await f.cleanup();}
});
test('desktop import enable grant reload disable and update preserve separation and stable tool identities',async()=>{
  const root=await mkdtemp(join(tmpdir(),'cshell-process-host-')),packageRoot=join(root,'packages');
  const pack=custom();await installCustomExtension(pack,packageRoot);const loaded=await loadProcessExtensions(packageRoot);assert.equal(loaded.length,1);
  let plugins:InstalledPlugin[]=[{manifest:pack.value.manifest,enabled:false,source:'custom:'+pack.sha256}];
  const vault=new ClientVault(join(root,'vault'),{encrypt:async s=>Buffer.from(s).toString('base64'),decrypt:async s=>Buffer.from(s,'base64').toString()});
  const options={directory:join(root,'host'),vault,version:'0.8.9',plugins:()=>plugins,root:packageRoot};let host=new ProcessExtensions(options);
  try{
    await host.refresh();assert.equal(host.applicationTools().length,0);assert.equal(host.list()[0].status,'authorization-required');await assert.rejects(host.authorize('example.process',['extension.execute']),/启用/);
    plugins=plugins.map(item=>({...item,enabled:true}));await host.refresh();assert.equal(host.applicationTools().length,0);
    await host.authorize('example.process',['extension.execute']);const tools=host.applicationTools();assert.equal(tools.length,1);assert.equal(host.applicationTools(),tools);assert.equal(tools[0].needsReview({}),true);assert.match(tools[0].description,/Local custom extension/);
    assert.equal(JSON.parse(await tools[0].invoke({value:'first'},signal())).value,'first');
    await host.dispose();host=new ProcessExtensions(options);await host.refresh();assert.equal(host.applicationTools().length,1);
    const stale=host.applicationTools()[0];plugins=plugins.map(item=>({...item,enabled:false}));await host.refresh();assert.equal(host.applicationTools().length,0);await assert.rejects(stale.invoke({},signal()),/disabled|replaced/);
    plugins=plugins.map(item=>({...item,enabled:true}));await host.refresh();assert.equal(host.applicationTools().length,1);
    const update=custom(source+'\n// new bytes');await installCustomExtension(update,packageRoot);plugins=[{manifest:update.value.manifest,enabled:true,source:'custom:'+update.sha256}];await host.refresh();assert.equal(host.applicationTools().length,0);assert.deepEqual(host.list()[0].grants,[]);
    await host.authorize('example.process',['extension.execute']);await host.authorize('example.process',[]);assert.equal(host.applicationTools().length,0);
  }finally{await host.dispose();await rm(root,{recursive:true,force:true});}
});
