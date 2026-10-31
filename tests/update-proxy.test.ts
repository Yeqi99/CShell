import test from 'node:test';import assert from 'node:assert/strict';import{createServer}from'node:http';import{updateRequest}from'../src/agent/update-request';import{windowsUpdateProxy,parseUpdateProxy}from'../src/agent/update-proxy';
test('system proxy parser chooses HTTPS, rejects PAC and unsupported protocols',()=>{
 assert.equal(windowsUpdateProxy({enabled:1,server:'http=127.0.0.1:80;https=127.0.0.1:7897'}),'http://127.0.0.1:7897/');assert.equal(windowsUpdateProxy({enabled:0}),undefined);assert.throws(()=>windowsUpdateProxy({pac:'https://example/pac'}),/PAC/);assert.throws(()=>windowsUpdateProxy({autoDetect:1}),/PAC/);assert.throws(()=>parseUpdateProxy('socks5://127.0.0.1:9999'),/CONNECT/);
});
test('proxy tunnel rejection never reaches direct target',async()=>{
 let direct=0,connects=0;const target=createServer(()=>{direct++;});const proxy=createServer();proxy.on('connect',(_req,socket)=>{connects++;socket.end('HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\n\r\n');});
 await new Promise<void>(r=>target.listen(0,'127.0.0.1',r));await new Promise<void>(r=>proxy.listen(0,'127.0.0.1',r));
 try{await assert.rejects(updateRequest(`https://127.0.0.1:${(target.address() as any).port}/`,{proxy:`http://127.0.0.1:${(proxy.address() as any).port}`,signal:AbortSignal.timeout(2000)}),/代理隧道/);assert.equal(direct,0);assert.equal(connects,1);}finally{await Promise.all([new Promise<void>(r=>target.close(()=>r())),new Promise<void>(r=>proxy.close(()=>r()))]);}
});
test('proxy handshake timeout destroys the owned tunnel and retains timeout reason',async()=>{
 const sockets=new Set<any>();const proxy=createServer();proxy.on('connect',(_req,socket)=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});socket.on('end',()=>socket.end());socket.resume();socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');});
 await new Promise<void>(r=>proxy.listen(0,'127.0.0.1',r));
 try{await assert.rejects(updateRequest('https://example.org/',{proxy:`http://127.0.0.1:${(proxy.address() as any).port}`,signal:AbortSignal.timeout(200)}),{name:'TimeoutError'});for(let i=0;i<50&&sockets.size;i++)await new Promise(r=>setTimeout(r,20));assert.equal(sockets.size,0);}finally{for(const socket of sockets)socket.destroy();await new Promise<void>(r=>proxy.close(()=>r()));}
});
