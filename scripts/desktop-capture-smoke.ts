import { NativeDesktop, type NativeDesktopFrame } from '../src/agent/desktop-native';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
// Capture a single real frame to exercise DXGI and hardware encoding. Its pixel
// payload stays in memory and is discarded; only performance metadata is saved.
const capture=new NativeDesktop(resolve('test-results/cagent-desktop-native.exe'));
let ready:any,count=0;
const result=new Promise<NativeDesktopFrame>((resolve,reject)=>{
 const timer=setTimeout(()=>reject(new Error('Capture deadline')),15000);
 capture.once('ready',value=>{ready=value;capture.requestFrame();});
 capture.on('frame',frame=>{count++;clearTimeout(timer);resolve(frame);});
 capture.on('fault',error=>{clearTimeout(timer);reject(error);});
 capture.on('closed',event=>{if(!count){clearTimeout(timer);reject(new Error(event.error||'Capture closed before frame'));}});
});
try{
 capture.start({fps:60,bitrate:12000000});const frame=await result;
 assert.ok(frame.key);assert.ok(frame.data.length>0);
 await new Promise(resolve=>setTimeout(resolve,500));assert.equal(count,1,'No new frame without consumer credit');
 const {data,...metadata}=frame;
 await writeFile('test-results/cagent-desktop-capture.json',JSON.stringify({ready,metadata,encodedBytes:data.length,noFrameWithoutCredit:true,pixelsPersisted:false},null,2));
 console.log(JSON.stringify({ready,metadata,encodedBytes:data.length,noFrameWithoutCredit:true}));
}finally{await capture.stop();}
