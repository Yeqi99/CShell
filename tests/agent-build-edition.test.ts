import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
test('CAgent build pins update channel to its edition',async()=>{
 const script=await readFile('scripts/agent-build.mjs','utf8');
 assert.match(script,/define:\s*\{\s*__CSHELL_PRO__:\s*"false"/);
 for(const pro of [false,true]){
  const result=await build({stdin:{contents:"import{downloadRoot}from './src/shared/download-source';console.log(downloadRoot)",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',write:false,define:{__CSHELL_PRO__:String(pro)}});
  let channel='';new Function('console',result.outputFiles[0].text)({log:(v:string)=>channel=v});
  assert.equal(channel,'https://shell.canp.ai/downloads/'+'opensource');
 }
});

test('desktop bundled Agent uses the actual edition define in both builds',async()=>{
 const script=(await readFile('scripts/build.mjs','utf8')).replace("import { build } from 'esbuild';",'');
 const AsyncFunction=Object.getPrototypeOf(async()=>{}).constructor;
 for(const pro of [false,true]){
  const calls:any[]=[];
  await new AsyncFunction('build','process',script)(async(options:any)=>{calls.push(options);},{env:{CSHELL_EDITION:pro?'pro':'opensource'}});
  for(const output of ['dist/main/main.cjs','dist/agent/agent.cjs','dist/cli/cshell.mjs']){
   const options=calls.find(call=>call.outfile===output);assert.ok(options,output);
   assert.equal(options.define?.__CSHELL_PRO__,"false",output);
   const result=await build({stdin:{contents:"import{downloadRoot}from './src/shared/download-source';console.log(downloadRoot)",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',write:false,define:options.define});
   let channel='';new Function('console',result.outputFiles[0].text)({log:(v:string)=>channel=v});
   assert.equal(channel,'https://shell.canp.ai/downloads/'+'opensource',output);
  }
 }
});
