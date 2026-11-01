import { _electron as electron } from 'playwright';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import assert from 'node:assert/strict';
import {newInstallationAiPolicy,emptyAiPolicy} from '../src/shared/ai';
const data=await mkdtemp(join(tmpdir(),'cshell-final-default-'));let app:any;
const launch=async()=>{const env={...process.env,CSHELL_TEST_DATA:data,CSHELL_TEST_START_GATE:'1'};delete env.ELECTRON_RUN_AS_NODE;app=await electron.launch({executablePath:process.env.CSHELL_EXECUTABLE!,args:[],env});await app.evaluate(()=>{(globalThis as any).__cshellPackagedTestAttached=true});const p=await app.firstWindow();await p.getByRole('heading',{name:'工作台',exact:true}).waitFor();return p;};
try{
 let p=await launch();assert.deepEqual((await p.evaluate(()=>window.cshell.aiSnapshot())).policy,newInstallationAiPolicy());assert.equal((await p.evaluate(()=>window.cshell.mcpStatus())).settings.enabled,false);
 await app.close();p=await launch();assert.deepEqual((await p.evaluate(()=>window.cshell.aiSnapshot())).policy,newInstallationAiPolicy());
 await p.evaluate(policy=>window.cshell.aiPolicySave(policy),emptyAiPolicy());await app.close();p=await launch();assert.deepEqual((await p.evaluate(()=>window.cshell.aiSnapshot())).policy,emptyAiPolicy());assert.equal((await p.evaluate(()=>window.cshell.mcpStatus())).settings.enabled,false);
 console.log('PASS exact packaged fresh AI all-known capabilities, persisted first-run, explicit denial survives restart, MCP remains off');
}finally{await app?.close().catch(()=>{});await rm(data,{recursive:true,force:true});}

