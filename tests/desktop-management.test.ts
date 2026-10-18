import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {EventEmitter,once} from 'node:events';
import {AgentReverseRelayService} from '../src/agent/relay-reverse';
import {AgentRelayService} from '../src/agent/relay';
import {ClientVault} from '../src/core/client/identity';
import {ClientServer} from '../src/core/client/server';
import {ClientProvider} from '../src/core/client/provider';
import {DesktopService} from '../src/agent/desktop-service';
import {connectDesktop} from '../src/core/desktop-client';
import type {NativeDesktop} from '../src/agent/desktop-native';
const codec={encrypt:async(v:string)=>Buffer.from(v).toString('base64'),decrypt:async(v:string)=>Buffer.from(v,'base64').toString()};
class Capture extends EventEmitter{stopped=false;count=0;start(){setImmediate(()=>this.emit('ready',{width:64,height:64,sourceWidth:64,sourceHeight:64,fps:30,encoder:'fixture',hardware:false}));}requestFrame(){setTimeout(()=>{if(!this.stopped)this.emit('frame',{id:this.count++,timestampUs:100,key:true,data:Buffer.alloc(512*1024,37)});},15);}requestKeyframe(){}revokeInput(){}async stop(){this.stopped=true;}}
for(const viaRelay of [false,'forward','reverse'] as const)test((viaRelay?viaRelay+' relay: ':'direct: ')+'desktop streams over pinned authenticated Agent TLS on one port, with separate view permission and revoke',{timeout:25000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'desktop-management-'));let desktop:DesktopService|undefined;let relay:AgentRelayService|undefined;let reverse:AgentReverseRelayService|undefined;const capture=new Capture();
 const server=new ClientServer(new ClientVault(join(dir,'host'),codec),{} as any,{desktopStream:(socket,owner)=>desktop!.acceptAuthenticated(socket,owner)});
 const client=new ClientProvider(new ClientVault(join(dir,'viewer'),codec),()=>{});let viewer:Awaited<ReturnType<typeof connectDesktop>>|undefined;
 try{await server.load();await client.load();const holder=createServer();holder.listen(0,'127.0.0.1');await once(holder,'listening');const port=(holder.address() as any).port;await new Promise<void>(r=>holder.close(()=>r()));
 await server.setAccess({password:'desktop-fixture-password-2026',shells:['cmd'],allowManage:true});await server.start({bind:'127.0.0.1',port});
 let relayConnection:any; if(viaRelay){const rv=new ClientVault(join(dir,'relay'),codec);relay=new AgentRelayService({vault:rv,identity:await rv.identity()});await relay.load();const rp=createServer();rp.listen(0,'127.0.0.1');await once(rp,'listening');const relayPort=(rp.address() as any).port;await new Promise<void>(r=>rp.close(()=>r()));await relay.configure({enabled:true,bind:'127.0.0.1',port:relayPort,targets:[viaRelay==='reverse'?{id:'desktop',mode:'reverse'}:{id:'desktop',host:'127.0.0.1',port}]});await relay.start();relayConnection={host:'127.0.0.1',port:relayPort,fingerprint:relay.status().fingerprint,credential:relay.revealCredential(),targetId:'desktop'};if(viaRelay==='reverse'){reverse=new AgentReverseRelayService({vault:new ClientVault(join(dir,'reverse'),codec)});await reverse.load();await reverse.configure({enabled:true,localPort:port,relay:{...relayConnection,credential:relay.registrationCredential({targetId:'desktop'})}});await reverse.start();const deadline=Date.now()+5000;while(!reverse.status().connected){if(Date.now()>deadline)throw new Error('Reverse connection timeout');await new Promise(r=>setTimeout(r,20));}}}
 const device=await client.pairPassword(await client.probe({host:viaRelay?'target.invalid':'127.0.0.1',port,relay:relayConnection}),'desktop-fixture-password-2026');const owner=server.status().peers[0].fingerprint;
 desktop=new DesktopService({identity:device.deviceId,nativeExecutable:'unused',authorize:o=>server.managementAllowed(o),captureFactory:()=>capture as unknown as NativeDesktop});
 await desktop.configure({enabled:true,directListener:false,ownerGrants:{}});assert.equal(desktop.status(owner).listening,false);assert.throws(()=>desktop!.open(owner,{transport:'management',quality:{fps:30,bitrate:1000000,display:0,adaptive:false}}),/DENIED/);
 await desktop.configure({enabled:true,directListener:false,ownerGrants:{[owner]:{view:true,control:false}}});
 const ticket=desktop.open(owner,{transport:'management',quality:{fps:30,bitrate:1000000,display:0,adaptive:false}});const badStream=await client.openDesktopStream(device.deviceId);await assert.rejects(connectDesktop({...ticket,keys:{...ticket.keys,bootstrap:'00'.repeat(32)}},{host:'127.0.0.1',expectedHostIdentity:device.deviceId,stream:badStream}));assert.equal(capture.count,0);const stream=await client.openDesktopStream(device.deviceId);viewer=await connectDesktop(ticket,{host:'127.0.0.1',expectedHostIdentity:device.deviceId,stream});
 const [frame]=await once(viewer,'frame');assert.equal(frame.data.length,512*1024);assert.equal(frame.data[0],37);viewer.ack(frame.id);assert.equal(capture.stopped,false);assert.equal(viewer.session.ready,true);assert.equal(viewer.session.mediaStats.rejectedPackets,0);
 const closed=once(viewer,'closed');await server.revoke(owner);await closed;await new Promise(r=>setTimeout(r,30));assert.equal(capture.stopped,true);
 }finally{await viewer?.close();client.dispose();await desktop?.shutdown();await server.stop();await reverse?.stop();await relay?.stop();await rm(dir,{recursive:true,force:true,maxRetries:5});}
});

