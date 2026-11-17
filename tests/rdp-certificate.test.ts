import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {createSecureContext,TLSSocket} from 'node:tls';
import {X509Certificate} from 'node:crypto';
import {createIdentity} from '../src/core/client/identity';
import {rdpCertificate} from '../src/core/rdp-certificate';

test('RDP preflight negotiates TLS, fingerprints the listener and sends no login',async()=>{
 const identity=await createIdentity();
 const context=createSecureContext({key:identity.key,cert:identity.certificate});
 let credentialBytes=0;
 const server=createServer(s=>s.once('data',request=>{
   assert.equal(request.toString('hex'),'030000130ee000000000000100080003000000');
   s.write(Buffer.from('030000130ed000001234000200080002000000','hex'),()=>{
     const tls=new TLSSocket(s,{isServer:true,secureContext:context});
     tls.on('data',chunk=>{credentialBytes+=chunk.length;});tls.on('error',()=>{});
   });
 }));
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 try{
   const {port}=server.address() as {port:number};
   assert.equal(await rdpCertificate('127.0.0.1',port),new X509Certificate(identity.certificate).fingerprint256.replaceAll(':','').toLowerCase());
 }finally{await new Promise<void>(r=>server.close(()=>r()));}
 assert.equal(credentialBytes,0);
});

test('RDP preflight refuses non-TLS and bounds stalled servers',async()=>{
 for(const silent of [false,true]){
   const server=createServer(s=>s.once('data',()=>{if(!silent)s.end(Buffer.from('030000130ed000001234000200080000000000','hex'));}));
   await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
   try{
     const {port}=server.address() as {port:number};
     await assert.rejects(rdpCertificate('127.0.0.1',port,120),silent?/超时/:/未提供/);
   }finally{await new Promise<void>(r=>server.close(()=>r()));}
 }
});
