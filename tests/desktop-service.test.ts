import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter,once} from 'node:events';
import {createServer} from 'node:net';
import {createSocket} from 'node:dgram';
import {DesktopSession} from '../src/agent/desktop-session';
import {DesktopService} from '../src/agent/desktop-service';
import {connectDesktop} from '../src/core/desktop-client';
import type {NativeDesktop,NativeDesktopInput} from '../src/agent/desktop-native';
async function ports(){const tcp=createServer();tcp.listen(0,'127.0.0.1');await once(tcp,'listening');const tcpPort=(tcp.address() as {port:number}).port;await new Promise<void>(resolve=>tcp.close(()=>resolve()));const udp=createSocket('udp4');udp.bind(0,'127.0.0.1');await once(udp,'listening');const udpPort=udp.address().port;udp.close();return {tcpPort,udpPort};}
class FakeCapture extends EventEmitter {
 frames=0;grants=0;revokes=0;lateFault=false;inputs:NativeDesktopInput[]=[];stopped=false;
 start(){setImmediate(()=>this.emit('ready',{width:64,height:64,sourceWidth:64,sourceHeight:64,fps:30,encoder:'test',hardware:false}));}
 requestFrame(){if(!this.stopped)setTimeout(()=>{if(!this.stopped)this.emit('frame',{id:this.frames++,timestampUs:100,key:true,data:Buffer.from('synthetic-frame')});},10);}
 requestKeyframe(){} grantInput(){this.grants++;} revokeInput(){this.revokes++;} input(e:NativeDesktopInput){this.inputs.push(e);}async stop(){this.stopped=true;if(this.lateFault){await new Promise(r=>setTimeout(r,20));this.emit('fault',new Error('write after end from retiring fixture'));}}
}
async function fixture(control=false){const captures:FakeCapture[]=[];let allowed=true,controlAllowed=true;const service=new DesktopService({identity:'device-1',nativeExecutable:'unused',authorize:(_owner,permission)=>allowed&&(permission!=='control'||controlAllowed),captureFactory:()=>{const c=new FakeCapture();captures.push(c);return c as unknown as NativeDesktop;}});await service.configure({enabled:true,bindAddress:'127.0.0.1',...await ports(),local:{view:true,control},ownerGrants:{viewer:{view:true,control}}});return {service,captures,revoke:()=>{allowed=false;},denyControl:()=>{controlAllowed=false;}};}
const quality={fps:30,bitrate:2000000,display:0,adaptive:false};
test('default off and separate owner view/control grants',{timeout:5000},async()=>{
 const {service}=await fixture();try{assert.throws(()=>service.open('other',{quality}),/DENIED/);assert.throws(()=>service.open('viewer',{quality,control:true}),/CONTROL_DENIED/);const ticket=service.open('viewer',{quality});assert.throws(()=>service.open('viewer',{quality}),/BUSY/);await assert.rejects(service.close('other',ticket.id),/NOT_FOUND/);await service.close('viewer',ticket.id);}finally{await service.shutdown();}
});
test('ticket bootstrap, frame credit, no implicit input, single-use ticket',{timeout:8000},async()=>{
 const {service,captures}=await fixture();try{const ticket=service.open('viewer',{quality});const client=await connectDesktop(ticket,{host:'127.0.0.1',expectedHostIdentity:'device-1',local:true});const frame=once(client,'frame');await frame;
 await new Promise(resolve=>setTimeout(resolve,60));assert.ok(captures[0].frames>1,'capture must not wait one RTT per frame');assert.equal(captures[0].grants,0);assert.throws(()=>client.input({kind:'key',code:30,down:true}),/permitted/);
 const second=once(client,'frame');client.ack('0');await second;assert.ok(captures[0].frames>1);
 await assert.rejects(connectDesktop(ticket,{host:'127.0.0.1',expectedHostIdentity:'device-1',local:true}));await client.close();
 }finally{await service.shutdown();}
});
test('backend revocation closes session and releases capture',{timeout:8000},async()=>{
 const {service,captures,revoke}=await fixture(true);try{const ticket=service.open('viewer',{quality,control:true});const client=await connectDesktop(ticket,{host:'127.0.0.1',expectedHostIdentity:'device-1',local:true});await once(client,'frame');assert.equal(captures[0].grants,1);const closed=once(client,'closed');revoke();await closed;assert.equal(captures[0].stopped,true);}finally{await service.shutdown();}
});
test('fake input releases on blur and control revocation preserves viewing',{timeout:8000},async()=>{
 const {service,captures,denyControl}=await fixture(true);try{const ticket=service.open('viewer',{quality,control:true});const client=await connectDesktop(ticket,{host:'127.0.0.1',expectedHostIdentity:'device-1',local:true});await once(client,'frame');
 client.input({kind:'key',code:30,down:true});await new Promise(r=>setTimeout(r,25));assert.equal(captures[0].inputs.length,1);
 client.releaseInput();await new Promise(r=>setTimeout(r,25));assert.equal(captures[0].revokes,1);assert.equal(captures[0].grants,2);
 denyControl();await new Promise(r=>setTimeout(r,300));assert.equal(captures[0].revokes,2);assert.equal(client.session.ready,true);
 client.input({kind:'key',code:31,down:true});await new Promise(r=>setTimeout(r,25));assert.equal(captures[0].inputs.length,1);await client.close();
 }finally{await service.shutdown();}
});
test('quality reconfiguration waits for consumer ack and starts fresh native stream',{timeout:8000},async()=>{
 const {service,captures}=await fixture();try{const ticket=service.open('viewer',{quality});const client=await connectDesktop(ticket,{host:'127.0.0.1',expectedHostIdentity:'device-1',local:true});await once(client,'frame');
 captures[0].lateFault=true;client.quality({...quality,bitrate:1000000});client.releaseInput();assert.equal(captures.length,1);
 const frame=once(client,'frame');client.ack('0');await frame;assert.equal(captures.length,2);assert.equal(captures[0].stopped,true);assert.equal(client.session.ready,true);await client.close();
 }finally{await service.shutdown();}
});




test('slow media send does not grant duplicate native frame credits',{timeout:8000},async()=>{
 const original=DesktopSession.prototype.sendFrame;let inFlight=0,maxFlight=0;DesktopSession.prototype.sendFrame=async function(frame){inFlight++;maxFlight=Math.max(maxFlight,inFlight);try{await new Promise(r=>setTimeout(r,1150));return await original.call(this,frame);}finally{inFlight--;}};
 const {service,captures}=await fixture();try{const ticket=service.open('viewer',{quality});const client=await connectDesktop(ticket,{host:'127.0.0.1',expectedHostIdentity:'device-1',local:true});await once(client,'frame');await new Promise(r=>setTimeout(r,1450));assert.equal(maxFlight,1);assert.ok(captures[0].frames>=2);assert.equal(client.session.ready,true);await client.close();}finally{await service.shutdown();DesktopSession.prototype.sendFrame=original;}
});

test('scale-only adaptation recovery reconfigures capture even when bitrate and fps are unchanged',{timeout:8000},async()=>{
 const {service,captures}=await fixture();try{const ticket=service.open('viewer',{quality:{...quality,adaptive:true}});const client=await connectDesktop(ticket,{host:'127.0.0.1',expectedHostIdentity:'device-1',local:true});client.on('frame',frame=>client.ack(frame.id));await once(client,'frame');
 const active=(service as any).active;active.adaptation.current.scale=.5;
 for(let i=0;i<4;i++){client.feedback({rttMs:1,jitterMs:1,loss:0,queueMs:1,decodeMs:1,deliveredBitsPerSecond:1000});await new Promise(r=>setTimeout(r,15));}
 await new Promise(r=>setTimeout(r,40));assert.equal(captures.length,2);assert.equal((service as any).active.quality.width,32);await client.close();
 }finally{await service.shutdown();}
});


test('native failure persists a bounded safe status and reaches viewer before socket closes',{timeout:8000},async()=>{
 const {service,captures}=await fixture();try{const ticket=service.open('viewer',{quality});const client=await connectDesktop(ticket,{host:'127.0.0.1',expectedHostIdentity:'device-1',local:true});await once(client,'frame');const closed=once(client,'closed');
 captures[0].emit('fault',new Error('desktop duplication: HRESULT 0x80070005 secret C:\\private\\credentials.txt'));
 assert.equal((await closed)[0],'CAPTURE_FAILED');const status=service.status('viewer');assert.equal(status.lastFailure?.code,'CAPTURE_FAILED');assert.equal(status.lastFailure?.message,'desktop duplication: 0x80070005');assert.ok(!JSON.stringify(status.lastFailure).includes('private'));assert.equal(service.status('unrelated').lastFailure,undefined);assert.deepEqual(service.status('local').lastFailure,status.lastFailure);await client.close();
 }finally{await service.shutdown();}
});
