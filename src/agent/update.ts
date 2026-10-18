import {mkdir,writeFile,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const repository='Yeqi99/CShell';
export function newer(a:string,b:string){const x=a.split('.').map(Number),y=b.split('.').map(Number);for(let i=0;i<3;i++){if(x[i]!==y[i])return x[i]>y[i];}return false;}
export function selectUpdate(releases:any[],current:string,arch:string){
 return releases.filter(r=>!r.draft&&!r.prerelease).flatMap(r=>(r.assets??[]).flatMap((a:any)=>{
  const m=/^CAgent-Setup-(\d+\.\d+\.\d+)-win-(x64|arm64)\.exe$/.exec(a.name??'');
  if(!m||m[2]!==arch||!newer(m[1],current))return [];
  const url=new URL(a.browser_download_url);if(url.origin!=='https://github.com'||!url.pathname.startsWith('/'+repository+'/releases/download/'))return [];
  if(!/^sha256:[a-f0-9]{64}$/i.test(a.digest??''))return [];
  return [{version:m[1],name:a.name,url:url.href,digest:a.digest.slice(7).toLowerCase(),size:a.size}];
 })).sort((a,b)=>newer(a.version,b.version)?-1:1)[0];
}
export class AgentUpdater{
 private candidate:ReturnType<typeof selectUpdate>;private state:any={phase:'idle'};
 constructor(private directory:string,private version:string){}
 async check(){if(process.platform!=='win32')throw new Error('此平台请从 GitHub 下载更新');const r=await fetch('https://api.github.com/repos/'+repository+'/releases?per_page=30',{headers:{Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error('检查更新失败：GitHub HTTP '+r.status);this.candidate=selectUpdate(await r.json() as any[],this.version,process.arch);return {current:this.version,available:!!this.candidate,version:this.candidate?.version};}
 status(){return this.state;}
 start(){if(this.state.phase==='downloading')return this.state;if(!this.candidate)throw new Error('请先检查可用更新');const c=this.candidate;this.state={phase:'downloading',bytes:0,total:c.size};void this.download(c).catch(e=>{this.state={phase:'failed',error:e.message};});return this.state;}
 private async download(c:NonNullable<typeof this.candidate>){
  const dir=join(this.directory,'updates');await mkdir(dir,{recursive:true});const path=join(dir,c.name),part=path+'.part';
  try{const r=await fetch(c.url,{signal:AbortSignal.timeout(300000)});if(!r.ok||!r.body)throw new Error('下载安装包失败');const chunks:Uint8Array[]=[];let count=0;for await(const chunk of r.body as any){count+=chunk.length;if(count>256*1024*1024||count>c.size)throw new Error('安装包大小异常');chunks.push(chunk);this.state={phase:'downloading',bytes:count,total:c.size};}const data=Buffer.concat(chunks);if(count!==c.size||createHash('sha256').update(data).digest('hex')!==c.digest)throw new Error('安装包校验失败');await writeFile(part,data);await rename(part,path);this.state={phase:'ready',path,version:c.version};}finally{await rm(part,{force:true});}
 }
}
