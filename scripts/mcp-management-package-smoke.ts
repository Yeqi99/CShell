import {_electron as electron} from 'playwright';
import {mkdtemp,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {createServer} from 'node:net';import assert from 'node:assert/strict';import {fixture} from '../tests/fixture';
const data=await mkdtemp(join(tmpdir(),'cshell-mcp-package-')),f=await fixture({execResult:{stdout:'partial',stderr:'failure',exitCode:7}});
const s=createServer();await new Promise<void>(r=>s.listen(0,'127.0.0.1',r));const port=(s.address() as any).port;await new Promise<void>(r=>s.close(()=>r()));
const env={...process.env,CSHELL_TEST_DATA:data,CSHELL_TEST_START_GATE:'1'};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:process.env.CSHELL_EXECUTABLE!,args:[],env});await app.evaluate(()=>{(globalThis as any).__cshellPackagedTestAttached=true;});
try{const p=await app.firstWindow();await p.waitForFunction(()=>!!window.cshell);
await p.evaluate(async port=>{const st=await window.cshell.mcpStatus();await window.cshell.mcpConfigure({...st.settings,enabled:true,port,review:'authorized',applicationCapabilities:['connections.read','connections.manage','credentials.manage','identity.trust'],allowedProfiles:[],allowCommands:true},st.revision);},port);
await app.evaluate(({clipboard})=>{clipboard.writeText=(v:string)=>{(globalThis as any).__token=v;};});await p.evaluate(()=>window.cshell.mcpCopyToken());const token=await app.evaluate(()=>(globalThis as any).__token);
const call=async(name:string,args:any={})=>{const r=await fetch(`http://127.0.0.1:${port}/api/v1/invoke`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Connection:'close'},body:JSON.stringify({name,arguments:args})});const v=await r.json() as any;assert.equal(r.status,200,JSON.stringify(v));return v.result;};
const created=await call('connection_create',{profile:{name:'packaged fixture',host:'127.0.0.1',port:f.port,username:'tester',auth:'password',group:'',favorite:false},secret:{password:f.password}});const id=created.profile.id;
assert(!JSON.stringify(created).includes(f.password));
await p.evaluate(async id=>{const st=await window.cshell.mcpStatus();await window.cshell.mcpConfigure({...st.settings,allowedProfiles:[id]},st.revision);},id);
const probe=await call('connection_probe',{id});assert.equal(f.authenticationRequests(),0);await call('connection_accept',{challenge:probe.challenge,fingerprint:probe.fingerprint});
const pre=await call('connection_preflight',{profileId:id,probe:true});assert.equal(pre.stages.authentication.outcome,'ok');assert.equal(f.shellRequests(),0);assert.equal(f.execRequests(),0);
const conn=await call('connect',{profileId:id});const result=await call('execute_command',{sessionId:conn.sessionId,command:'fixture failure'});assert.equal(result.stdout,'partial');assert.equal(result.stderr,'failure');assert.equal(result.exitCode,7);
assert.equal((await call('session_list')).sessions[0].sessionId,conn.sessionId);assert(Array.isArray((await call('task_list')).tasks));assert((await call('permission_diagnostics',{profileId:id})).application.includes('identity.trust'));
console.log('PASS actual packaged MCP create/probe/trust/auth-only preflight, stdout/stderr/exit, own sessions/tasks and permission diagnostics; isolated data and no clipboard modification');
}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});f.disconnectAll();await f.close();await rm(data,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
