import {_electron as electron} from 'playwright';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const data=await mkdtemp(join(tmpdir(),'tavily-desktop-'));
const app=await electron.launch({args:process.env.CSHELL_EXECUTABLE?[]:['.'],...(process.env.CSHELL_EXECUTABLE?{executablePath:process.env.CSHELL_EXECUTABLE}:{}),env:{...process.env,CSHELL_TEST_DATA:data,CSHELL_TEST_START_GATE:'1'}});
try{
 assert.equal(await app.evaluate(({app})=>app.getVersion()),'0.6.37');const page=await app.firstWindow();await page.waitForFunction(()=>!!window.cshell);
 const result=await page.evaluate(async()=>{
  await window.cshell.pluginInstall('cshell.tavily');await window.cshell.pluginToggle('cshell.tavily',true);
  const status=await window.cshell.aiExtensionCall('cshell.tavily','status',{});
  await window.cshell.pluginToggle('cshell.tavily',false);let denied=false;
  try{await window.cshell.aiExtensionCall('cshell.tavily','status',{});}catch{denied=true;}
  return {status,denied};
 });
 assert.deepEqual(result.status,{accounts:[],allowPaygo:false});assert.equal(result.denied,true);
 await writeFile('test-results/tavily-desktop-smoke.json',JSON.stringify({version:'0.6.37',passed:true,ipcStatus:true,disableDenied:true,isolated:true}));console.log('PASS Tavily real desktop plugin install, status IPC, disable denial');
}finally{await app.close();await rm(data,{recursive:true,force:true});}
