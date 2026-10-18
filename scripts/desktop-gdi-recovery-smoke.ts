import {NativeDesktop} from '../src/agent/desktop-native';
import {resolve} from 'node:path';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const native=new NativeDesktop(resolve('release/0.6.23/agent-win32-x64/cagent-desktop.exe'));
let frames=0,info:any;
try{await new Promise<void>((yes,no)=>{const timeout=setTimeout(()=>no(new Error('GDI timeout')),20000);native.on('fault',no);native.on('closed',e=>no(new Error(JSON.stringify(e))));native.on('ready',value=>{info=value;native.requestFrame();});native.on('frame',()=>{frames++;if(frames>=30){clearTimeout(timeout);yes();}else native.requestFrame();});native.start({width:640,height:360,fps:30,bitrate:1000000,forceGdi:1});});assert.equal(info.capturePath,'gdi');await writeFile('test-results/desktop-gdi-recovery-native.json',JSON.stringify({passed:true,frames,capturePath:info.capturePath,encoder:info.encoder,inputInjected:false},null,2));}finally{await native.stop();}
