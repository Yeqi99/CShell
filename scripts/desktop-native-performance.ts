import {NativeDesktop,type NativeDesktopFrame} from '../src/agent/desktop-native';
import {resolve} from 'node:path';
import {writeFile} from 'node:fs/promises';
// Desktop pixels stay in memory. This measures actual changed-screen delivery;
// static-screen FPS is not a throughput benchmark. No input grant is requested.
const executable=resolve(process.argv[2]??'test-results/cagent-desktop-native.exe');
const destination=process.argv[3]??'test-results/desktop-native-performance.json';
const seconds=Number(process.argv[4]??15);
const capture=new NativeDesktop(executable);
const frames:{at:number;captureUs:number;convertUs:number;encodeUs:number;bytes:number}[]=[];
let ready:unknown,error:unknown,started=0;
const summary=(values:number[])=>{const v=[...values].sort((a,b)=>a-b);return {mean:v.reduce((a,b)=>a+b,0)/v.length,p50:v[Math.floor(v.length*.5)],p95:v[Math.floor(v.length*.95)],max:v.at(-1)};};
const done=new Promise<void>((ok,fail)=>{
 const deadline=setTimeout(()=>fail(new Error('Native ready timeout')),20000);
 capture.once('ready',value=>{clearTimeout(deadline);ready=value;started=performance.now();capture.requestFrame();setTimeout(ok,seconds*1000);});
 capture.on('fault',e=>{clearTimeout(deadline);fail(e);});capture.on('closed',event=>{if(event.code){clearTimeout(deadline);fail(new Error(event.error));}});
 capture.on('frame',(frame:NativeDesktopFrame)=>{frames.push({at:performance.now(),captureUs:frame.captureUs,convertUs:frame.convertUs,encodeUs:frame.encodeUs,bytes:frame.data.length});capture.requestFrame();});
});
try{capture.start({fps:60,bitrate:12000000});await done;}catch(e){error=String(e);}finally{await capture.stop();}
const report={ready,seconds,frames:frames.length,deliveredFps:frames.length/seconds,captureUs:summary(frames.map(f=>f.captureUs)),convertUs:summary(frames.map(f=>f.convertUs)),encodeUs:summary(frames.map(f=>f.encodeUs)),intervalMs:summary(frames.slice(1).map((f,i)=>f.at-frames[i].at)),firstFrameMs:frames[0]?.at-started,pixelsPersisted:false,inputGranted:false,error};
await writeFile(destination,JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(error)process.exitCode=1;
