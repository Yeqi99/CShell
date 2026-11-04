import test from 'node:test';
import assert from 'node:assert/strict';
import {formatUpdateProgress} from '../src/shared/update-progress';
import {AgentUpdater} from '../src/agent/update';

test('update progress shares readable byte units with file transfers and handles unknown totals',()=>{
 assert.equal(formatUpdateProgress(0,1024),'0 B / 1 KiB');
 assert.equal(formatUpdateProgress(1536,3*1024*1024),'1.5 KiB / 3 MiB');
 assert.equal(formatUpdateProgress(1.25*1024**3,2*1024**3),'1.3 GiB / 2 GiB');
 assert.equal(formatUpdateProgress(0,0),'0 B / 总大小未知');
 assert.equal(formatUpdateProgress(undefined,undefined),'— / 总大小未知');
 assert.equal(formatUpdateProgress(-1,NaN),'— / 总大小未知');
 assert.equal(formatUpdateProgress(Infinity,-1),'— / 总大小未知');
});
test('updater status presents progress without changing exact counters',()=>{
 const status=AgentUpdater.prototype.status.call({state:{phase:'downloading',bytes:1234567,total:25000000},automatic:true} as any);
 assert.equal(status.bytes,1234567);assert.equal(status.total,25000000);
 assert.equal(status.progressText,'1.2 MiB / 23.8 MiB');
});
