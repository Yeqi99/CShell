import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createAgentRuntime} from '../src/agent/runtime';
import {callAgent} from '../src/agent/control';

test('local API reports default and custom model through an unreadable old cloud bundle',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'cagent-model-status-'));
 const original='unreadable-legacy-cache';
 await writeFile(join(directory,'cloud-bundle.enc'),original);
 const runtime=await createAgentRuntime({directory});
 try{
  await runtime.startControl();
  assert.deepEqual(await callAgent('assistant.model.status',{},directory),{source:'trial',displayName:'体验基座',configured:true});
  const account=await callAgent('account.status',{},directory);
  assert.match(account.transportError,/原文件已保留/);
  await callAgent('assistant.model.configure',{endpoint:'https://example.invalid/v1',model:'local-demo',key:'synthetic-fixture'},directory);
  assert.deepEqual(await callAgent('assistant.model.status',{},directory),{source:'configured',displayName:'local-demo',configured:true});
  assert.equal(await readFile(join(directory,'cloud-bundle.enc'),'utf8'),original);
 }finally{await runtime.close();await rm(directory,{recursive:true,force:true,maxRetries:4});}
});
