import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {connect} from 'node:net';
import {tunnelFetch} from '../src/core/tunnel-fetch';
test('explicit proxy tunnel streams real HTTP body and never falls back after failure',async()=>{
 const server=createServer((req,res)=>{if(req.url==='/redirect'){res.writeHead(302,{location:'http://unrelated.invalid'});res.end();return;}res.setHeader('content-type','text/event-stream');res.write('data: one\n\n');setTimeout(()=>res.end('data: two\n\n'),10);});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const port=(server.address() as any).port;
 let calls=0;const request=tunnelFetch(async(host,p)=>{calls++;assert.equal(host,'proxy-target.invalid');assert.equal(p,80);return connect(port,'127.0.0.1');});
 try{const response=await request('http://proxy-target.invalid/');assert.equal(await response.text(),'data: one\n\ndata: two\n\n');await assert.rejects(request('http://proxy-target.invalid/redirect',{redirect:'error'}),/重定向/);assert.equal(calls,2);
 const failing=tunnelFetch(async()=>{throw Error('egress down')});await assert.rejects(failing('http://127.0.0.1:'+port),/egress down/);
 }finally{await new Promise<void>(r=>server.close(()=>r()));}
});
