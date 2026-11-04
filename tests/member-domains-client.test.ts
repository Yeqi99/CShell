import test from 'node:test';import assert from 'node:assert/strict';
import {CloudSync} from '../src/core/cloud-sync';
test('domain client validates commands, excludes account injection and returns sanitized state',async()=>{
 const calls:any[]=[];const state={namespace:null,membershipActive:true,renameAvailable:true,nextRenameAt:null,timezone:'Asia/Shanghai',recordLimit:100,domains:[],records:[],capabilities:{read:true,claim:true,rename:false,writeDns:false,deleteDns:true},providerToken:'must-not-surface'};
 const request:typeof fetch=async(url,options)=>{calls.push({url:String(url),body:options?.body&&JSON.parse(String(options.body))});return Response.json(state);};
 const cloud=new CloudSync('unused',{encrypt:async x=>x,decrypt:async x=>x},{export:async()=>({}),import:async()=>{},validate:()=>{}},'https://fixture.invalid/api',request);(cloud as any).data={session:{accountId:'a',token:'test',email:'a@test.invalid'},revision:0};
 await assert.rejects(cloud.domains({action:'claim',prefix:'alice',requestId:'claim-001',account:'b'} as any));assert.equal(calls.length,0);
 const result=await cloud.domains({action:'claim',prefix:'alice',requestId:'claim-001'});assert.equal(calls[0].url,'https://fixture.invalid/api/v1/domains/claim');assert.deepEqual(calls[0].body,{prefix:'alice',requestId:'claim-001'});assert(!('providerToken'in result));assert.equal(calls[1].url,'https://fixture.invalid/api/v1/domains');
});
test('domain request propagates cancellation without issuing a second request',async()=>{
 const stop=new AbortController();let calls=0;
 const request:typeof fetch=async(_url,options)=>{calls++;assert(options?.signal);return new Promise((_resolve,reject)=>options.signal!.addEventListener('abort',()=>reject(options.signal!.reason),{once:true}));};
 const cloud=new CloudSync('unused',{encrypt:async x=>x,decrypt:async x=>x},{export:async()=>({}),import:async()=>{},validate:()=>{}},'https://fixture.invalid/api',request);(cloud as any).data={session:{accountId:'a',token:'test',email:'a@test.invalid'},revision:0};
 const pending=cloud.domains({action:'claim',prefix:'alice',requestId:'claim-002'},stop.signal);stop.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(calls,1);
 await assert.rejects(cloud.domains(undefined,stop.signal),{name:'AbortError'});assert.equal(calls,1);
});
