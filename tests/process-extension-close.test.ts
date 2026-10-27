import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import type {ChildProcess,spawn} from 'node:child_process';
import {stopChild} from '../src/agent/process-capability';

test('extension termination waits for actual child closure after taskkill exits', {skip:process.platform!=='win32'}, async()=>{
 const child=Object.assign(new EventEmitter(),{pid:123,exitCode:null,signalCode:null,kill:()=>true}) as unknown as ChildProcess;
 const helper=Object.assign(new EventEmitter(),{kill:()=>true}) as unknown as ChildProcess;
 let close!:()=>void;const closed=new Promise<void>(resolve=>{close=resolve;});
 let settled=false;
 const stopping=stopChild(child,closed,(()=>helper) as typeof spawn).then(()=>{settled=true;});
 helper.emit('exit',0);await new Promise(resolve=>setImmediate(resolve));
 try{assert.equal(settled,false,'helper exit is not proof that extension handles are closed');}
 finally{close();await stopping;}
 assert.equal(settled,true);
});

test('an exited extension still waits for its streams to close', async()=>{
 const child={pid:123,exitCode:0,signalCode:null} as ChildProcess;
 let close!:()=>void;const closed=new Promise<void>(resolve=>{close=resolve;});
 let settled=false;const stopping=stopChild(child,closed).then(()=>{settled=true;});
 await new Promise(resolve=>setImmediate(resolve));
 try{assert.equal(settled,false,'exitCode alone is not the close event');}finally{close();await stopping;}
});

test('unclosed handles fail within a bounded deadline instead of claiming completion', async context=>{
 context.mock.timers.enable({apis:['setTimeout']});
 const child={pid:123,exitCode:0,signalCode:null} as ChildProcess;
 const rejected=assert.rejects(stopChild(child,new Promise<void>(()=>{})),/did not close after termination/);
 context.mock.timers.tick(3000);await rejected;
});
