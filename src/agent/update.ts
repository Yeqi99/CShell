import { requestUpdateWithFallback } from '../shared/update-source-fallback';
import {prepareAgentReplacement} from './posix-update';
import {prepareWindowsAgentReplacement} from './windows-update';
import {updateRequest} from './update-request';
import {mkdir,writeFile,rename,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {trustedDownload} from '../shared/download-source';
export function newer(a:string,b:string){const x=a.split('.').map(Number),y=b.split('.').map(Number);for(let i=0;i<3;i++){if(x[i]!==y[i])return x[i]>y[i];}return false;}
export function selectUpdate(releases:any[],current:string,arch:string,platform:NodeJS.Platform='win32'){
 return releases.filter(r=>!r.draft).flatMap(r=>(r.assets??[]).flatMap((a:any)=>{
  const m=platform==='win32'?/^CAgent-Setup-(\d+\.\d+\.\d+)-win-(x64|arm64)\.exe$/.exec(a.name??''):/^CAgent-(\d+\.\d+\.\d+)-(linux|mac)-(x64|arm64)\.tar\.gz$/.exec(a.name??'');
  if(m&&platform!=='win32'){if(m[2]!==({linux:'linux',darwin:'mac'} as Record<string,string>)[platform])return [];m[2]=m[3];}
  if(!m||m[2]!==arch||!newer(m[1],current))return [];
  if(!trustedDownload(a.browser_download_url)||!Number.isSafeInteger(a.size)||a.size<=0||a.size>256*1024*1024)return [];
  const url=new URL(a.browser_download_url);
  if(!/^sha256:[a-f0-9]{64}$/i.test(a.digest??''))return [];
  return [{version:m[1],name:a.name,url:url.href,digest:a.digest.slice(7).toLowerCase(),size:a.size}];
 })).sort((a,b)=>newer(a.version,b.version)?-1:1)[0];
}
export class AgentUpdater{
 private candidate:ReturnType<typeof selectUpdate>;private state:any={phase:'idle'};
 private verified?:{path:string;digest:string};
 private lifetime=new AbortController();
 private assertOpen(){this.lifetime.signal.throwIfAborted();}
 private automatic=true;private timer:ReturnType<typeof setInterval>|undefined;private checking=false;
 private failedVersion?:{version:string;retryAt:number};
 constructor(private directory:string,private version:string,private request:typeof updateRequest=updateRequest){}
 async initialize(){try{const saved=JSON.parse(await readFile(join(this.directory,'update-settings.json'),'utf8'));this.automatic=saved.automatic!==false;}catch{}try{const result=JSON.parse(await readFile(join(this.directory,'update-result.json'),'utf8'));if(['rollback-pending','rolled-back'].includes(result.state)&&/^\d+\.\d+\.\d+$/.test(result.version)&&Number.isFinite(result.at))this.failedVersion={version:result.version,retryAt:result.at+6*60*60*1000};}catch{}if(this.lifetime.signal.aborted)return;if(['win32','linux','darwin'].includes(process.platform)){this.timer=setInterval(()=>void this.tick(),6*60*60*1000);this.timer.unref();void this.tick();}}
 close(){if(this.timer)clearInterval(this.timer);this.timer=undefined;this.lifetime.abort(new Error('更新服务已关闭'));}
 private settingsWrite:Promise<void>=Promise.resolve();
 async settings(automatic?:boolean){
  this.assertOpen();
  const snapshot=()=>({automatic:this.automatic,supported:['win32','linux','darwin'].includes(process.platform)});
  if(automatic===undefined){await this.settingsWrite;this.assertOpen();return snapshot();}
  const write=this.settingsWrite.then(async()=>{
   this.assertOpen();
   await mkdir(this.directory,{recursive:true});
   const path=join(this.directory,'update-settings.json');
   await writeFile(path+'.tmp',JSON.stringify({automatic}));
   await rename(path+'.tmp',path);
   // Only a persisted preference may change the running update scheduler.
   this.automatic=automatic;
   if(automatic)void this.tick();
   return snapshot();
  });
  // A failed save must not poison later changes or reads of the last saved value.
  this.settingsWrite=write.then(()=>{},()=>{});
  return write;
 }
 private async tick(){if(this.lifetime.signal.aborted||!this.automatic||this.checking||['ready','downloading'].includes(this.state.phase))return;this.checking=true;try{const result=await this.check();if(result.available&&this.automatic){if(this.failedVersion&&this.failedVersion.version===result.version&&Date.now()<this.failedVersion.retryAt)this.state={phase:'deferred',version:result.version,retryAt:this.failedVersion.retryAt,error:'此版本上次启动未通过核验，已保留原后台，稍后再自动检查'};else this.start();}}catch(e){if(!this.lifetime.signal.aborted)this.state={phase:'failed',error:e instanceof Error?e.message:String(e)};}finally{this.checking=false;}}
 private fetchUpdate(url:string,timeout:number){return requestUpdateWithFallback(url,candidate=>{this.assertOpen();return this.request(candidate,{headers:{Accept:'application/json','User-Agent':'CAgent/'+this.version},signal:AbortSignal.any([this.lifetime.signal,AbortSignal.timeout(timeout)])});});}
 async check(){this.assertOpen();if(!['win32','linux','darwin'].includes(process.platform))throw new Error('当前平台没有更新安装包');const r=await this.fetchUpdate('https://shell.canp.ai/downloads/pro/releases.json',15000);if(!r.ok)throw new Error('检查更新失败：香港更新服务 HTTP '+r.status);const releases=await r.json();this.assertOpen();if(!Array.isArray(releases))throw new Error('更新目录格式不正确');this.candidate=selectUpdate(releases,this.version,process.arch,process.platform);return {current:this.version,available:!!this.candidate,version:this.candidate?.version};}
 async prepareInstall(identity?:string){
  await this.verify();
  if(!identity)throw Error('缺少更新目标身份');
  if(process.platform==='win32'){
   return prepareWindowsAgentReplacement(this.verified!.path,this.state.version,this.directory,identity);
  }
  return prepareAgentReplacement(this.verified!.path,this.state.version,this.directory,identity);
 }
 status(){return {...this.state,automatic:this.automatic};}
 async verify(){if(this.state.phase!=='ready'||!this.verified||createHash('sha256').update(await readFile(this.verified.path)).digest('hex')!==this.verified.digest)throw Error('更新文件已改变，请重新下载');return this.status();}
 start(){this.assertOpen();if(this.state.phase==='downloading')return this.state;if(!this.candidate)throw new Error('请先检查可用更新');const c=this.candidate;this.state={phase:'downloading',bytes:0,total:c.size};void this.download(c).catch(e=>{if(!this.lifetime.signal.aborted)this.state={phase:'failed',error:e.message};});return this.state;}
 private async download(c:NonNullable<typeof this.candidate>){
  const dir=join(this.directory,'updates');await mkdir(dir,{recursive:true});const path=join(dir,c.name),part=path+'.part';
  try{this.assertOpen();const r=await this.fetchUpdate(c.url,300000);if(!r.ok||!r.body)throw new Error('下载安装包失败');const chunks:Uint8Array[]=[];let count=0;for await(const chunk of r.body as any){count+=chunk.length;if(count>256*1024*1024||count>c.size)throw new Error('安装包大小异常');chunks.push(chunk);this.state={phase:'downloading',bytes:count,total:c.size};}this.assertOpen();const data=Buffer.concat(chunks);if(count!==c.size||createHash('sha256').update(data).digest('hex')!==c.digest)throw new Error('安装包校验失败');await writeFile(part,data);this.assertOpen();await rename(part,path);this.assertOpen();this.verified={path,digest:c.digest};this.state={phase:'ready',path,version:c.version};}finally{await rm(part,{force:true});}
 }
}
