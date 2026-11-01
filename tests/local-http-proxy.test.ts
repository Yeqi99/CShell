import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request} from 'node:http';
import {connect} from 'node:net';
import {localHttpProxy} from '../src/core/local-http-proxy';
test('loopback system proxy forwards real HTTP only through selected exit',async()=>{
 let requests=0;const server=createServer((_req,res)=>{requests++;res.end('through-exit')});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 let fail=false;const proxy=await localHttpProxy(async(host,port)=>{assert.equal(host,'destination.invalid');assert.equal(port,80);if(fail)throw Error('offline');return connect((server.address() as any).port,'127.0.0.1');});
 const get=()=>new Promise<{status:number;body:string}>((resolve,reject)=>{const req=request({host:'127.0.0.1',port:proxy.port,path:'http://destination.invalid/'},res=>{let body='';res.on('data',b=>body+=b);res.on('end',()=>resolve({status:res.statusCode!,body}));});req.on('error',reject);req.end();});
 try{assert.deepEqual(await get(),{status:200,body:'through-exit'});fail=true;assert.equal((await get()).status,502);assert.equal(requests,1);}finally{proxy.close();await new Promise<void>(r=>server.close(()=>r()));}
});
