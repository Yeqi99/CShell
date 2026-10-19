/** Cross-language integration fixture: actual Agent TLS + desktop crypto, no real desktop input. */
import {ClientServer} from '../src/core/client/server';
import {ClientVault} from '../src/core/client/identity';
import {DesktopSession} from '../src/agent/desktop-session';
import {desktopLine,desktopProof} from '../src/agent/desktop-service';
import {randomBytes} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
const root=await mkdtemp(join(tmpdir(),'android-desktop-'));
const vault=new ClientVault(root,{encrypt:async s=>s,decrypt:async s=>s});
let ticket:any;const sessions=new Set<DesktopSession>();let receivedInputs=0,acks=0;
const server=new ClientServer(vault,{} as any,{
 shells:async()=>[],
 manage:async(method,params,signal,owner)=>{
  if(method==='agent.shells')return [];
  if(method==='desktop.status')return {packageReady:true,viewAllowed:true,controlAllowed:true};
  if(method!=='desktop.open')throw Error('Unsupported fixture method');
  ticket={id:randomBytes(16).toString('hex'),hostIdentity:(await vault.identity()).id,owner,expiresAt:Date.now()+30000,generation:randomBytes(16).toString('hex'),session:randomBytes(8).toString('hex'),control:true,keys:Object.fromEntries(['hostControl','viewerControl','hostMedia','viewerMedia','bootstrap'].map(k=>[k,randomBytes(32).toString('hex')]))};return ticket;
 },
 desktopStream:async(socket,owner)=>{
  const t=ticket,nonce=randomBytes(32).toString('hex');socket.write(JSON.stringify({version:1,nonce})+'\n');const hello=JSON.parse(await desktopLine(socket));if(owner!==t.owner||hello.id!==t.id||hello.proof!==desktopProof(t.keys.bootstrap,`client:${nonce}:${t.id}`))throw Error('Bad proof');socket.write(JSON.stringify({proof:desktopProof(t.keys.bootstrap,`server:${nonce}:${t.id}`)})+'\n');
  const d=new DesktopSession({control:socket,transport:'tcp',authorized:()=>true,release:()=>{},binding:{localIdentity:t.hostIdentity,peerIdentity:owner,generation:t.generation,session:Buffer.from(t.session,'hex'),sendControlKey:Buffer.from(t.keys.hostControl,'hex'),receiveControlKey:Buffer.from(t.keys.viewerControl,'hex'),sendMediaKey:Buffer.from(t.keys.hostMedia,'hex'),receiveMediaKey:Buffer.from(t.keys.viewerMedia,'hex'),peerAddress:socket.remoteAddress!.replace(/^::ffff:/,'')}});sessions.add(d);d.once('closed',()=>sessions.delete(d));
  let frame=0n;const send=()=>d.sendFrame({id:frame++,timestamp:1000n,key:true,data:Buffer.alloc(100000,73)});
  d.on('ready',()=>{d.video({width:64,height:64,sourceWidth:64,sourceHeight:64,fps:30,codec:'avc1.4d001e',encoder:'test-payload',hardware:false});void send();});
  d.on('ack',()=>{acks++;if(frame<3n)void send();});d.on('input',()=>receivedInputs++);await d.start();socket.resume();
 }
});
await server.load();const password=randomBytes(24).toString('hex');await server.setAccess({password,shells:['cmd'],allowManage:true});await server.start({bind:'127.0.0.1',port:47840});
await writeFile('test-results/android-desktop-fixture.json',JSON.stringify({host:'10.0.2.2',port:47840,password,fingerprint:server.status().fingerprint}));
console.log('isolated Android desktop fixture ready');
async function stop(){await writeFile('test-results/android-desktop-native-result.json',JSON.stringify({receivedInputs,acks}));for(const d of sessions)await d.close();await server.stop();await rm(root,{recursive:true,force:true});process.exit();}
setTimeout(()=>void stop(),10*60*1000);process.on('SIGINT',()=>void stop());process.on('SIGTERM',()=>void stop());
