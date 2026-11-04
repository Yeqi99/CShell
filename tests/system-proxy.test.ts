import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WindowsSystemProxy} from '../src/desktop/system-proxy';
const previous={ProxyEnable:1,ProxyServer:'127.0.0.1:7890',ProxyOverride:'<local>',AutoConfigURL:null,AutoDetect:0};
test('explicit system proxy saves/restores old settings without touching user changes',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'system-proxy-'));let current={...previous};let writes=0;
 const run=async(script:string)=>{if(script.includes('Get-ItemProperty'))return JSON.stringify(current);const encoded=script.match(/FromBase64String\('([^']+)'\)/)?.[1];assert.ok(encoded);current=JSON.parse(Buffer.from(encoded,'base64').toString());writes++;return '';};
 const codec={encryptPrivate:async(s:string)=>s,decryptPrivate:async(s:string)=>s};
 const proxy=new WindowsSystemProxy(dir,codec,async()=>{throw Error('egress offline')},async()=>{},'win32',run);
 let captured=false,released=0;
 proxy.beforeEnable=async state=>{assert.deepEqual(state,previous);assert.deepEqual(current,previous);captured=true;};
 proxy.afterDisable=async()=>{released++;};
 try{
  await proxy.recover();assert.equal(writes,0);
  await proxy.set(true);assert.equal(captured,true);assert.equal(proxy.status().enabled,true);assert.match(current.ProxyServer,/http=127\.0\.0\.1:/);
  await proxy.set(false);assert.deepEqual(current,previous);assert.equal(released,1);
  await proxy.set(true);current={...previous,ProxyServer:'user-new-proxy:8080'};
  await proxy.set(false);assert.equal(current.ProxyServer,'user-new-proxy:8080');
 }finally{await proxy.close();await rm(dir,{recursive:true,force:true});}
});

test('unavailable exit prevents system changes and unsupported platforms reject explicitly',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'system-proxy-fail-'));let writes=0;
 const codec={encryptPrivate:async(s:string)=>s,decryptPrivate:async(s:string)=>s};
 const p=new WindowsSystemProxy(dir,codec,async()=>{throw Error('unused')},async()=>{throw Error('exit unavailable')},'win32',async()=>{writes++;return JSON.stringify(previous)});
 try{await assert.rejects(p.set(true),/exit unavailable/);assert.equal(writes,0);assert.equal(p.status().enabled,false);}finally{await p.close();await rm(dir,{recursive:true,force:true});}
});

test('unsupported platform shutdown is inert even after a rejected enable request', async()=>{
 let touched=0;
 const unused=async()=>{touched++;throw Error('must not touch Windows state');};
 const proxy=new WindowsSystemProxy('unused',{encryptPrivate:unused,decryptPrivate:unused},unused,unused,'linux',unused);
 await proxy.recover();
 await assert.rejects(proxy.set(true),/不支持/);
 await proxy.close();
 await proxy.close();
 assert.equal(touched,0);
 assert.deepEqual(proxy.status(),{supported:false,enabled:false,error:''});
});

test('system proxy listener forwards real HTTP and fails closed when exit disappears',async()=>{
 const {createServer}=await import('node:http');const {connect}=await import('node:net');const {request}=await import('node:http');
 const origin=createServer((_req,res)=>res.end('chosen-egress'));
 await new Promise<void>(r=>origin.listen(0,'127.0.0.1',r));const originPort=(origin.address() as any).port;
 const dir=await mkdtemp(join(tmpdir(),'system-proxy-stream-'));let current={...previous},online=true;
 const run=async(script:string)=>{if(script.includes('Get-ItemProperty'))return JSON.stringify(current);const encoded=script.match(/FromBase64String\('([^']+)'\)/)![1];current=JSON.parse(Buffer.from(encoded,'base64').toString());return '';};
 const codec={encryptPrivate:async(s:string)=>s,decryptPrivate:async(s:string)=>s};
 const proxy=new WindowsSystemProxy(dir,codec,async(host,port)=>{assert.equal(host,'chosen-exit.test');assert.equal(port,80);if(!online)throw Error('exit offline');return connect({host:'127.0.0.1',port:originPort});},async()=>{},'win32',run);
 try{
  await proxy.set(true);const port=Number(current.ProxyServer.match(/http=127.0.0.1:(\d+)/)![1]);
  const get=()=>new Promise<{code:number,text:string}>((resolve,reject)=>{const req=request({host:'127.0.0.1',port,path:'http://chosen-exit.test/',headers:{Host:'chosen-exit.test',Connection:'close'}},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>resolve({code:res.statusCode!,text}));});req.on('error',reject);req.end();});
  assert.deepEqual(await get(),{code:200,text:'chosen-egress'});online=false;
  assert.equal((await get()).code,502);assert.equal(proxy.status().enabled,true);
 }finally{await proxy.close();await new Promise<void>(r=>origin.close(()=>r()));await rm(dir,{recursive:true,force:true});}
});
