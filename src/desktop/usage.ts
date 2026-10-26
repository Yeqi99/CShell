import {app, net, type BrowserWindow} from 'electron';
import {readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';

// Separate local opt-in; never cloud-synced or imported with appearance settings.
export function registerUsage(handle:(name:string,fn:(...args:any[])=>any)=>void, window:BrowserWindow) {
 const file=join(app.getPath('userData'),'usage-consent.json');
 let consent={enabled:false,token:''}, busy=false;
 let writes=Promise.resolve();
 const persist=()=>{const snapshot=JSON.stringify(consent);const operation=writes.catch(()=>{}).then(async()=>{const temp=file+'.next';await writeFile(temp,snapshot,{mode:0o600});await rename(temp,file);});writes=operation;return operation;};
 const loaded=readFile(file,'utf8').then(raw=>{const value=JSON.parse(raw);if(typeof value.enabled==='boolean' && /^[a-f0-9]{64}$/.test(value.token))consent=value;}).catch(()=>{});
 const request=async(path:string,body?:unknown)=>{const r=await net.fetch('https://shell.canp.ai/api/v1/public/'+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,credentials:'omit',redirect:'error',signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error('统计服务暂不可用');return r.json();};
 const pulse=async()=>{await loaded;if(busy||!consent.token)return;busy=true;const sent={...consent};try{await request('usage-device',sent);if(!sent.enabled && !consent.enabled && sent.token===consent.token){consent.token='';await persist();}}catch{}finally{busy=false;}};
 handle('usage:read',async()=>{await loaded;return {enabled:consent.enabled};});
 handle('usage:consent',async(enabled:unknown)=>{await loaded;if(typeof enabled!=='boolean')throw Error('Invalid consent');const previous={...consent};consent={enabled,token:consent.token||(enabled?randomBytes(32).toString('hex'):'')};try{await persist();}catch(error){consent=previous;throw error;}void pulse();return {enabled};});
 void loaded.then(()=>pulse());const timer=setInterval(()=>void pulse(),60000);timer.unref();window.once('closed',()=>clearInterval(timer));
}
