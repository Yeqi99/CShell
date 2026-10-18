import {createServer} from 'node:net';
import {createSocket} from 'node:dgram';
import {once} from 'node:events';
import {resolve} from 'node:path';
import {writeFile} from 'node:fs/promises';
import {DesktopService} from '../src/agent/desktop-service';
import {connectDesktop} from '../src/core/desktop-client';
const tcp=createServer();tcp.listen(0,'127.0.0.1');await once(tcp,'listening');const tcpPort=(tcp.address() as {port:number}).port;await new Promise<void>(r=>tcp.close(()=>r()));
const udp=createSocket('udp4');udp.bind(0,'127.0.0.1');await once(udp,'listening');const udpPort=udp.address().port;udp.close();
const service=new DesktopService({identity:'loopback-smoke-device',nativeExecutable:resolve('test-results/cagent-desktop-native.exe'),authorize:()=>true});
const deadline=setTimeout(()=>{console.error('Service smoke deadline');void service.shutdown();process.exitCode=1;},15000);
try{
 await service.configure({enabled:true,bindAddress:'127.0.0.1',tcpPort,udpPort,local:{view:true,control:false}});
 const ticket=service.open('local',{control:false,quality:{fps:60,bitrate:12000000,display:0,adaptive:false}});
 const started=performance.now();const viewer=await connectDesktop(ticket,{host:'127.0.0.1',expectedHostIdentity:'loopback-smoke-device',local:true});let video:unknown;
 viewer.on('video',v=>video=v);const [frame]=await once(viewer,'frame');
 const report={ok:true,bootstrap:'single-use ticket over authenticated-management boundary + challenge HMAC',transport:'encrypted TCP + authenticated UDP path',firstFrameMs:performance.now()-started,frameBytes:frame.data.length,key:frame.key,video,inputInjected:false,viewOnly:true,pixelsPersisted:false,publicNetworkTested:false};
 await viewer.close();await service.shutdown();await writeFile('test-results/cagent-desktop-service-smoke.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{clearTimeout(deadline);await service.shutdown();}
