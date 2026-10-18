import {desktopTestTarget} from './desktop-test-target';
const expectedTarget=desktopTestTarget();
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {z} from 'zod';
import {once} from 'node:events';
import {ClientVault,fingerprint} from '../src/core/client/identity';
import {ClientProvider} from '../src/core/client/provider';
import {agentCodec} from '../src/agent/storage';
import {connectDesktop} from '../src/core/desktop-client';
import type {DesktopTicket} from '../src/shared/agent-desktop';
const receipt=z.object({protocol:z.literal(1),deviceId:z.string().uuid(),name:z.string(),host: z.literal(expectedTarget.host),port: z.literal(expectedTarget.port),certificate:z.string(),fingerprint:z.string()}).passthrough().parse(JSON.parse(await readFile(process.argv[2]??'test-results/desktop-server-deploy/server-receipt.json','utf8')));
if(fingerprint(receipt.certificate)!==receipt.fingerprint)throw Error('Server receipt fingerprint mismatch');
const directory=resolve('test-results/desktop-test-controller');
const vault=new ClientVault(directory,await agentCodec(directory));
// The receipt must arrive through the existing authenticated RDP deployment channel.
await vault.write('devices',[{protocol:1,deviceId:receipt.deviceId,name:receipt.name,host:receipt.host,port:receipt.port,certificate:receipt.certificate}]);
const provider=new ClientProvider(vault,()=>{});await provider.load();
let viewer:Awaited<ReturnType<typeof connectDesktop>>|undefined,ticket:DesktopTicket|undefined;
const guard=new AbortController();const timer=setTimeout(()=>guard.abort(new Error('Acceptance deadline')),45000);
try{
 const started=performance.now();
 ticket=await provider.call(receipt.deviceId,{method:'desktop.open',params:{control:false,transport:'management',quality:{fps:60,bitrate:12000000,display:0,adaptive:true}}},guard.signal) as DesktopTicket;
 const stream=await provider.openDesktopStream(receipt.deviceId,guard.signal);
 try{viewer=await connectDesktop(ticket,{host:receipt.host,expectedHostIdentity:receipt.deviceId,stream});}catch(error){stream.destroy();throw error;}
 let frames=0,bytes=0,firstFrameMs:number|undefined,lastFrameAt=0;const closed:string[]=[];
 viewer.on('closed',reason=>{closed.push(String(reason));console.log('closed',String(reason));});
 viewer.on('notice',value=>console.log('notice',value));viewer.on('video',value=>console.log('video',value));
 viewer.on('frame',frame=>{firstFrameMs??=performance.now()-started;frames++;bytes+=frame.data.length;lastFrameAt=Date.now();viewer!.ack(frame.id);});
 console.log('Authenticated desktop channel ready');
 await Promise.race([once(viewer,'frame',{signal:guard.signal}),once(viewer,'closed',{signal:guard.signal}).then(([reason])=>{throw Error(`Desktop closed: ${reason}`);})]);
 const sampleStart=Date.now();await new Promise(r=>setTimeout(r,15000));
 const result={time:new Date().toISOString(),server:receipt.host,managementPort:receipt.port,transport:'authenticated Agent TLS with encrypted desktop TCP media',sampleMs:Date.now()-sampleStart,frames,bytes,firstFrameMs,lastFrameAgeMs:Date.now()-lastFrameAt,closed,video:viewer.videoInfo,inputInjected:false,renderingMeasured:false,pixelsPersisted:false,publicNetworkTested:true};
 await writeFile('test-results/desktop-public-smoke.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 if(frames<2||closed.length)throw Error('Public video continuity failed');
}finally{clearTimeout(timer);await viewer?.close();if(ticket)await provider.call(receipt.deviceId,{method:'desktop.close',params:{id:ticket.id}},AbortSignal.timeout(5000)).catch(()=>{});provider.dispose();}
