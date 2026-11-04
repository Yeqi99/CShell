import {_electron as electron} from 'playwright';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import assert from 'node:assert/strict';
assert(process.env.CSHELL_EXECUTABLE,'CSHELL_EXECUTABLE must name the completed package');
const data=await mkdtemp(join(tmpdir(),'cshell-update-mcp-'));
const socket=createServer();await new Promise<void>(r=>socket.listen(0,'127.0.0.1',r));
const port=(socket.address() as {port:number}).port;await new Promise<void>(r=>socket.close(()=>r()));
const env={...process.env,CSHELL_TEST_DATA:data,CSHELL_TEST_START_GATE:'1'};delete env.ELECTRON_RUN_AS_NODE;
const application=await electron.launch({executablePath:process.env.CSHELL_EXECUTABLE!,args:[],env});
await application.evaluate(()=>{(globalThis as any).__cshellPackagedTestAttached=true;});
try {
 const page=await application.firstWindow();await page.waitForFunction(()=>!!window.cshell);
 await page.evaluate(async port=>{const s=await window.cshell.mcpStatus();await window.cshell.mcpConfigure({...s.settings,enabled:true,port,review:'authorized',applicationCapabilities:['updates.manage']},s.revision);},port);
 await application.evaluate(({clipboard})=>{clipboard.writeText=(s:string)=>{(globalThis as any).__updateToken=s;};});
 await page.evaluate(()=>window.cshell.mcpCopyToken());
 const token=await application.evaluate(()=>(globalThis as any).__updateToken);
 const call=async(args:unknown)=>{const response=await fetch(`http://127.0.0.1:${port}/api/v1/invoke`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Connection:'close'},body:JSON.stringify({name:'application_update',arguments:args})});return {status:response.status,body:await response.json() as any};};
 const state=await call({action:'status'});assert.equal(state.status,200,JSON.stringify(state.body));
 assert.match(JSON.stringify(state.body),/current/);
 for(const args of [{action:'install'},{action:'install',acknowledgeRestart:true},{action:'check',url:'http://127.0.0.1/evil.exe'}]) {
  const result=await call(args);assert(result.status!==200||result.body.error||result.body.isError,JSON.stringify(result));
 }
 await page.evaluate(async()=>{const s=await window.cshell.mcpStatus();await window.cshell.mcpConfigure({...s.settings,applicationCapabilities:[]},s.revision);});
 const denied=await call({action:'status'});assert(denied.status!==200||denied.body.error||denied.body.isError,JSON.stringify(denied));
 console.log('PASS packaged MCP update status, grant revocation, URL rejection, restart acknowledgement and unverified installer rejection; no actual installer started');
} finally {
 await application.evaluate(({app})=>app.exit(0)).catch(()=>{});await application.close().catch(()=>{});
 await rm(data,{recursive:true,force:true,maxRetries:10,retryDelay:200});
}
