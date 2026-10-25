import {build} from 'esbuild';
import {_electron as electron} from 'playwright';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const directory=await mkdtemp(join(tmpdir(),'cshell-decoder-'));
await writeFile(join(directory,'blank.html'),'<title>Decoder fixture</title>');
await build({stdin:{contents:`
import {app,BrowserWindow} from 'electron';import {decodeDesktopFrame} from './src/desktop/desktop-frame-decoder';
app.on('window-all-closed',()=>{});app.whenReady().then(async()=>{const source=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});try{
await source.loadFile(${JSON.stringify(join(directory,'blank.html'))});
const data=await source.webContents.executeJavaScript('('+function(){return new Promise<number[]>((resolve,reject)=>{const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const ctx=canvas.getContext('2d')!;ctx.fillStyle='#135864';ctx.fillRect(0,0,640,360);const encoder=new VideoEncoder({output:chunk=>{const bytes=new Uint8Array(chunk.byteLength);chunk.copyTo(bytes);resolve([...bytes]);},error:reject});encoder.configure({codec:'avc1.42001f',width:640,height:360,bitrate:1000000,framerate:1,avc:{format:'annexb'},hardwareAcceleration:'prefer-software'});const frame=new VideoFrame(canvas,{timestamp:0});encoder.encode(frame,{keyFrame:true});frame.close();encoder.flush().finally(()=>encoder.close());});}.toString()+')()');
const result=await decodeDesktopFrame({id:'fixture',type:'frame',data:new Uint8Array(data),key:true,sequence:'1',timestamp:0},{maxWidth:320,quality:75},new AbortController().signal);
if(result.width!==320||result.height!==180||!result.dataBase64.startsWith('/9j/'))throw Error('Invalid decoded image');
globalThis.result={ok:true,width:result.width,height:result.height,bytes:Buffer.byteLength(result.dataBase64,'base64'),inputInjected:false,pixelsPersisted:false};
}catch(error){globalThis.result={error:String(error),stack:error.stack};}finally{source.destroy();}});`,loader:'ts',resolveDir:process.cwd()},bundle:true,platform:'node',external:['electron'],outfile:join(directory,'main.cjs')});
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const instance=await electron.launch({args:[join(directory,'main.cjs')],env});
try{let result:any;for(let i=0;i<150;i++){result=await instance.evaluate(()=>globalThis['result']);if(result)break;await new Promise(r=>setTimeout(r,100));}if(!result?.ok)throw Error(JSON.stringify(result));console.log('PASS H264-to-JPEG decoder',JSON.stringify(result));}finally{await instance.close();}
