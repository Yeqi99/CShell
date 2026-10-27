import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {performance} from 'node:perf_hooks';
import type {spawn} from 'node:child_process';
import {HostingService} from '../src/agent/hosting';

test('cancelled hosting work does not start a worker',async()=>{
 let starts=0;
 const service=new HostingService('.',(()=>{starts++;throw Error('must not spawn');}) as unknown as typeof spawn);
 const controller=new AbortController();controller.abort();
 await assert.rejects((service as any).runCode({children:new Set()},'return 1',{},controller.signal),/已取消/);
 assert.equal(starts,0);
});

for(const startupMs of [4000,6000])test(`hosting startup ${startupMs}ms consumes the same five-second budget`,async context=>{
 context.mock.timers.enable({apis:['setTimeout']});
 let now=0,sends=0,kills=0;
 context.mock.method(performance,'now',()=>now);
 const child=Object.assign(new EventEmitter(),{
  stdout:new EventEmitter(),stderr:new EventEmitter(),
  send:()=>{sends++;},
 });
 const service=new HostingService('.',(()=>{now+=startupMs;return child;}) as unknown as typeof spawn);
 (service as any).kill=async()=>{kills++;};
 const active={children:new Set()};
 const result=(service as any).runCode(active,'while(true){}',{},new AbortController().signal) as Promise<unknown>;
 const rejected=assert.rejects(result,/5 秒/);
 context.mock.timers.tick(Math.max(0,5000-startupMs));
 await Promise.resolve();
 try {
  assert.equal(kills,1,'startup must not reset the execution deadline');
  assert.equal(sends,startupMs>=5000?0:1,'expired startup must not dispatch user code');
 } finally {context.mock.timers.tick(5000);await rejected;}
 assert.equal(active.children.size,0);
});
