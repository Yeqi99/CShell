import test from 'node:test';import assert from 'node:assert/strict';
import {directMachineCopy} from '../src/core/direct-machine-copy';
test('direct copy revokes tickets and only permits fallback before writes',async()=>{
 const calls:string[]=[];const source=async(method:string)=>{calls.push(method);return {ticket:'secret',certificate:'certificate',size:12};};
 const run=(target:any)=>directMachineCopy(source,target,{host:'192.0.2.1',port:24443},{root:'a',path:'/x'},{root:'b',path:'/y'},new AbortController().signal,()=>{},()=>{});
 let pulled=0;
 assert.equal(await run(async(method:string)=>{if(method==='files.transferIdentity')return {fingerprint:'recipient'};throw Error('probe unreachable');}),undefined);assert.equal(calls.at(-1),'files.transferRevoke');
 await assert.rejects(run(async(method:string)=>{if(method==='files.transferIdentity')return {fingerprint:'recipient'};if(method==='files.transferProbe')return{};pulled++;throw Error('write outcome unknown');}),/unknown/);assert.equal(pulled,1);assert.equal(calls.at(-1),'files.transferRevoke');
 const result=await run(async(method:string)=>{if(method==='files.transferIdentity')return{fingerprint:'recipient'};if(method==='files.transferProbe')return{};return{bytes:12,sha256:'digest',route:'direct-tls'};});assert.equal(result?.route,'direct-tls');assert(!JSON.stringify(result).includes('secret'));
});
