import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {registerNetworkDiagnostics} from '../src/desktop/network-diagnostics';

test('unsaved connection probe tests the supplied endpoint without touching saved connections',async()=>{
  const server=createServer(socket=>socket.end());
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const handlers=new Map<string,Function>();
  const unavailable=new Proxy({}, {get(){throw Error('Saved state must not be accessed');}});
  const close=registerNetworkDiagnostics((name,fn)=>handlers.set(name,fn),unavailable as any,unavailable as any,unavailable as any,unavailable as any);
  try{
    const port=(server.address() as {port:number}).port;
    const result=await handlers.get('network:connection-probe')!({host:'127.0.0.1',port});
    assert.equal(result.host,'127.0.0.1');assert.equal(result.port,port);assert.equal(result.failed,0);assert.equal(result.samples.length,1);
    await assert.rejects(handlers.get('network:connection-probe')!({host:'localhost/path',port}));
    await assert.rejects(handlers.get('network:connection-probe')!({host:'localhost',port,password:'not accepted'}));
  }finally{close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
