import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {AgentTerminalProvider} from '../src/core/agent-terminal';
test('selected machine exit reaches new host PTYs but never a WSL environment',async()=>{
 const launched:Record<string,string>[]=[];let target='http://127.0.0.1:32123';
 const provider=new AgentTerminalProvider(()=>{},async()=>[
  {id:'sh',label:'host',executable:'/bin/sh',args:[],environment:'host'},
  {id:'wsl:Fixture',label:'WSL',executable:'wsl.exe',args:[],environment:'wsl',distribution:'Fixture'},
 ],((_exe:any,_args:any,options:any)=>{launched.push(options.env);return {onData:()=>({dispose(){}}),onExit:()=>({dispose(){}}),kill(){},write(){},resize(){},pause(){},resume(){}};}) as any);
 provider.networkEnvironment=()=>({HTTPS_PROXY:target,CSHELL_PROXY_FIXTURE:'only-host'});
 try{await provider.connect('sh',undefined,new AbortController().signal);target='http://127.0.0.1:32124';await provider.connect('sh',undefined,new AbortController().signal);await provider.connect('wsl:Fixture',undefined,new AbortController().signal);assert.equal(launched[0].HTTPS_PROXY,'http://127.0.0.1:32123');assert.equal(launched[1].HTTPS_PROXY,target);assert.equal(launched[2].CSHELL_PROXY_FIXTURE,undefined);}finally{await provider.dispose();}
});
test('machine exit environment reaches actual command child without changing parent',async()=>{
 const shell=process.platform==='win32'?'powershell':'sh';const executable=process.platform==='win32'?join(process.env.SystemRoot!,'System32/WindowsPowerShell/v1.0/powershell.exe'):'/bin/sh';
 const before=process.env.CSHELL_PROXY_FIXTURE;const provider=new AgentTerminalProvider(()=>{},async()=>[{id:shell,label:shell,executable,args:[],environment:'host'}]);provider.networkEnvironment=()=>({CSHELL_PROXY_FIXTURE:'selected-exit'});
 try{const result=await provider.execute({shell,command:process.platform==='win32'?'[Console]::Write($env:CSHELL_PROXY_FIXTURE)':'printf %s "$CSHELL_PROXY_FIXTURE"',timeoutMs:15000},new AbortController().signal);assert.equal(result.stdout,'selected-exit');assert.equal(result.exitCode,0);assert.equal(process.env.CSHELL_PROXY_FIXTURE,before);}finally{await provider.dispose();}
});
