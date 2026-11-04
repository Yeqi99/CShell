import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {applicationUpdateTool} from '../src/core/application-update-tool';
import {UpdateReceipt} from '../src/desktop/update-receipt';
test('update rejects arbitrary source and unacknowledged restart, requires live authorization',async()=>{
 let calls=0;const tool=applicationUpdateTool({state:()=>({phase:'ready'}),run:async(_a,g)=>{g();calls++;}});const signal=new AbortController().signal;
 assert.equal(tool.capability,'updates.manage');
 await assert.rejects(tool.invoke({action:'install'},signal));
 await assert.rejects(tool.invoke({action:'download',url:'https://evil.test'},signal));
 await assert.rejects(tool.invoke({action:'install',acknowledgeRestart:true},signal,undefined,()=>{throw Error('revoked');}));
 assert.equal(calls,0);
 await tool.invoke({action:'install',acknowledgeRestart:true},signal);assert.equal(calls,1);
 await tool.invoke({action:'status'},signal);assert.equal(calls,1);
});
test('restart receipt only verifies actual target version after reload',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'cshell-receipt-'));try{const old=new UpdateReceipt(dir,'0.8.21');await old.save({targetVersion:'1.0.0',phase:'scheduled'});assert.equal(old.status()?.verified,false);const failed=new UpdateReceipt(dir,'0.8.21');await failed.load();assert.equal(failed.status()?.verified,false);const next=new UpdateReceipt(dir,'1.0.0');await next.load();assert.equal(next.status()?.verified,true);}finally{await rm(dir,{recursive:true,force:true});}
});
