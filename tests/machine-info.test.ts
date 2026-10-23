import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as os from 'node:os';
import {machineSnapshot} from '../src/agent/machine-info';
test('machine snapshot belongs to actual host and unavailable detail stays explicit',async()=>{
 const value=await machineSnapshot();
 assert.equal(value.hostname,os.hostname());assert.equal(value.platform,process.platform);
 assert(value.memory.total>0);assert(value.cpu.length>0);assert(value.at<=Date.now());
 for(const key of ['gpu','disks','processes','ports'] as const)assert(value[key]||value.errors[key]);
 assert(value.processes.split('\n').length<=32);
 assert(!value.processes.includes('CommandLine'));
});
