import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MachineNetworkRoute} from '../src/desktop/machine-network-route';
function fixture(){let opens=0,closes=0,alive=true;const profile={id:'saved',name:'Agent',protocol:'client',host:'target',port:24443};const store={profile:()=>({...profile}),snapshot:()=>({profiles:[profile,{id:'rdp',protocol:'rdp'}]}),host:()=>undefined};const agents={list:()=>[{deviceId:'saved',fingerprint:'pinned'}],browserTransport:async()=>{opens++;return{validate:()=>{if(!alive)throw Error('closed')},close:()=>{closes++},call:async()=>{throw Error('unused')}}}};const route=new MachineNetworkRoute(store as any,agents as any);return{route,profile,stats:()=>({opens,closes}),offline:()=>{alive=false}};}
test('saved CAgent route opens dedicated authenticated transport once and closes on shutdown',async()=>{const f=fixture();try{assert.equal((await f.route.list()).length,1);const [a,b]=await Promise.all([f.route.proxy('saved'),f.route.proxy('saved')]);assert.match(a,/^socks5:\/\/127.0.0.1:\d+$/);assert.equal(a,b);assert.equal(f.stats().opens,1);}finally{await f.route.close();}assert.equal(f.stats().closes,1);await assert.rejects(f.route.proxy('saved'),/关闭/);});
test('changed saved endpoint invalidates pooled route and does not reuse prior transport',async()=>{const f=fixture();try{const a=await f.route.proxy('saved');f.profile.host='changed';const b=await f.route.proxy('saved');assert.notEqual(a,b);assert.deepEqual(f.stats(),{opens:2,closes:1});}finally{await f.route.close();}});
test('unknown SSH identity and unavailable authentication fail closed',async()=>{const store={profile:()=>({id:'s',protocol:'ssh',host:'x',port:22}),host:()=>undefined};const route=new MachineNetworkRoute(store as any,{} as any);await assert.rejects(route.proxy('s'),/核对身份/);await route.close();});
test('jump chains reject repeated identity before any network access',async()=>{const f=fixture();const route=new MachineNetworkRoute({} as any,{} as any,['saved']);await assert.rejects(route.proxy('saved'),/循环/);await route.close();await f.route.close();});
test('CAgent tunnel forwards exact requested destination without local DNS or direct fallback',async()=>{const calls:any[]=[];const profile={id:'saved',protocol:'client',host:'target',port:24443};const route=new MachineNetworkRoute({profile:()=>profile,host:()=>undefined} as any,{list:()=>[{deviceId:'saved',fingerprint:'pin'}],browserTransport:async()=>({validate:()=>{},close:()=>{},call:async(method:string,params:any)=>{calls.push({method,params});if(method==='browser.open')return{id:'remote-stream'};return{};}})} as any);try{const socket=await route.tunnel('saved','private.internal',443);assert.deepEqual(calls[0],{method:'browser.open',params:{host:'private.internal',port:443}});socket.destroy();}finally{await route.close();}});
import ssh2 from 'ssh2';
import {generateKeyPairSync,createHash} from 'node:crypto';
import {once} from 'node:events';
test('real SSH jump transport forwards bytes with pinned host key and no terminal',async()=>{
 const key=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs1',format:'pem'},publicKeyEncoding:{type:'pkcs1',format:'pem'}});
 const server=new ssh2.Server({hostKeys:[key.privateKey]},client=>{client.on('error',()=>{});client.on('authentication',ctx=>ctx.accept());client.on('ready',()=>client.on('tcpip',(accept,_reject,info)=>{assert.equal(info.destIP,'destination.invalid');assert.equal(info.destPort,443);const stream=accept();stream.on('data',(data:Buffer)=>stream.write(data));}));});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const port=(server.address() as any).port;
 const {utils}=ssh2;const parsed=utils.parseKey(key.privateKey);if(parsed instanceof Error)throw parsed;
 const pin='SHA256:'+createHash('sha256').update(parsed.getPublicSSH()).digest('base64').replace(/=+$/,'');
 const profile={id:'ssh',protocol:'ssh',host:'127.0.0.1',port,username:'user'};
 const route=new MachineNetworkRoute({profile:()=>profile,host:()=>pin,secret:async()=>({password:'test-only'})} as any,{} as any);
 try{const stream=await route.tunnel('ssh','destination.invalid',443);const data=once(stream,'data');stream.write('via-ssh');assert.equal(String((await data)[0]),'via-ssh');stream.destroy();}finally{await route.close();await new Promise<void>(r=>server.close(()=>r()));}
});
