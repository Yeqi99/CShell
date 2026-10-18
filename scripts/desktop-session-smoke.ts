import { createServer,createConnection,type Socket } from 'node:net';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DesktopSession,type DesktopSessionBinding } from '../src/agent/desktop-session';
import { NativeDesktop,type NativeDesktopFrame } from '../src/agent/desktop-native';

// A real local capture/encode/UDP transfer test. Pixels are never persisted.
const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');
const accepted=once(server,'connection');const client=createConnection((server.address() as {port:number}).port,'127.0.0.1');
const [host]=await accepted as [Socket];server.close();
const keys=Array.from({length:4},()=>randomBytes(32));
const binding:DesktopSessionBinding={localIdentity:'smoke-host',peerIdentity:'smoke-viewer',generation:randomBytes(16).toString('hex'),session:randomBytes(8),sendControlKey:keys[0],receiveControlKey:keys[1],sendMediaKey:keys[2],receiveMediaKey:keys[3],peerAddress:'127.0.0.1'};
const capture=new NativeDesktop(resolve('test-results/cagent-desktop-native.exe'));
const sender=new DesktopSession({binding,control:host,authorized:()=>true,release:()=>capture.stop()});
const viewer=new DesktopSession({binding:{...binding,localIdentity:'smoke-viewer',peerIdentity:'smoke-host',sendControlKey:keys[1],receiveControlKey:keys[0],sendMediaKey:keys[3],receiveMediaKey:keys[2]},control:client,authorized:()=>true,release:()=>{}});
sender.on('closed',r=>console.log('sender closed',r));viewer.on('closed',r=>console.log('viewer closed',r));
const deadline=setTimeout(()=>{void sender.close('SMOKE_TIMEOUT');void viewer.close('SMOKE_TIMEOUT');console.error('Desktop smoke deadline exceeded');process.exitCode=1;},10000);
try{
 const ready=Promise.all([once(sender,'ready'),once(viewer,'ready')]);await Promise.all([sender.start(),viewer.start()]);await ready;console.log("session ready");
 const encoded=once(capture,'frame');const configured=once(capture,'ready');
 capture.on('fault',error=>{throw error;});capture.start({fps:60,bitrate:12000000});const [info]=await configured;capture.requestFrame();console.log("capture ready");
 const [native]=await encoded as [NativeDesktopFrame];console.log("encoded",native.data.length);const received=once(viewer,'frame');const start=performance.now();
 if(!await sender.sendFrame({id:BigInt(native.id),timestamp:BigInt(native.timestampUs),key:native.key,data:native.data}))throw new Error('Send failed');
 console.log('sent',viewer.mediaStats);const [frame]=await received;if(!frame.data.equals(native.data))throw new Error('Payload mismatch');
 const report={ok:true,transport:'loopback TCP control + UDP media / AES-256-GCM',source:info,encodedBytes:native.data.length,networkMs:performance.now()-start,authenticatedPackets:viewer.mediaStats.authenticatedPackets,frames:viewer.stats.receivedFrames,inputInjected:false,rendered:false,publicNetworkTested:false};
 await writeFile('test-results/cagent-desktop-session-smoke.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{clearTimeout(deadline);await Promise.all([sender.close(),viewer.close()]);}



