import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, chmod, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import locks from './native-database-packages.json';
import type { DatabaseApp } from '../shared/database-apps';
export const runNative = promisify(execFile);
const mirrors = ['https://mirrors.tuna.tsinghua.edu.cn/anaconda/cloud/conda-forge/', 'https://conda.anaconda.org/conda-forge/'];
const microHashes = {x64:'c04571cfb0750e5432d530a3068b8fcd232ebed3133358e056e59a90b9852b00',arm64:'a64db0d7a82107c8d64357cf035fb8f9dbbe2fc48f48b302cbc8ba1590974e20'};
const milvusHashes = {x64:'dbde998c1d8b798dfb804904da939f6a1a18b09749b11f6badf1692154059510',arm64:'7b9e1188f6f93e809e79705ccc341c5cca1bca7570ca6baffd6cd977fa94b2ac'};
export const nativeVersions = {mysql:'MySQL 8.4.2',redis:'Redis 7.4.7',milvus:'Milvus 2.6.27'};
export const nativeArch = process.platform==='linux' && (process.arch==='x64'||process.arch==='arm64') ? process.arch : undefined;

async function digest(path:string){
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(path))hash.update(chunk);
  return hash.digest('hex');
}
async function rangedArchive(path:string,sha:string,url:string,bytes:number,signal:AbortSignal,log:(s:string)=>void){
  const parts=path+'.'+sha.slice(0,16)+'.parts';
  await mkdir(parts,{recursive:true,mode:0o700});
  const chunk=4*1024*1024,count=Math.ceil(bytes/chunk);
  let next=0,completed=0;
  const stop=new AbortController();
  const fetchParts=async()=>{
    while(next<count){
      const i=next++,first=i*chunk,last=Math.min(bytes,first+chunk)-1,length=last-first+1,part=join(parts,String(i));
      signal.throwIfAborted();stop.signal.throwIfAborted();
      if((await stat(part).catch(()=>undefined))?.size!==length){
        const task=AbortSignal.any([signal,stop.signal,AbortSignal.timeout(120000)]);
        const r=await fetch(url,{headers:{Range:'bytes='+first+'-'+last,'Accept-Encoding':'identity'},signal:task});
        if(r.status!==206||r.headers.get('content-range')!=='bytes '+first+'-'+last+'/'+bytes){await r.body?.cancel();throw Error('源不支持分段下载');}
        const tmp=part+'.'+randomUUID();
        let total=0;
        const sizeCheck=new Transform({transform(b,_e,done){total+=b.length;done(total>length?Error('分段长度不符'):null,b);}});
        try{
          if(!r.body)throw Error('下载内容为空');
          await pipeline(r.body as any,sizeCheck,createWriteStream(tmp,{flags:'wx',mode:0o600}),{signal:task});
          if(total!==length)throw Error('分段不完整');
          await rename(tmp,part);
        }finally{await rm(tmp,{force:true});}
      }
      if(++completed%8===0)log('已下载 '+Math.min(bytes,completed*chunk)/1048576+' / '+Math.ceil(bytes/1048576)+' MiB');
    }
  };
  const workers=Array.from({length:6},()=>fetchParts().catch(e=>{stop.abort(e);throw e;}));
  const results=await Promise.allSettled(workers),failure=results.find(r=>r.status==='rejected');
  if(failure?.status==='rejected')throw failure.reason;
  const tmp=path+'.'+randomUUID();
  try{
    async function* readParts(){for(let i=0;i<count;i++)yield* createReadStream(join(parts,String(i)));}
    await pipeline(readParts(),createWriteStream(tmp,{flags:'wx',mode:0o600}),{signal});
    if(await digest(tmp)!==sha){await rm(parts,{recursive:true,force:true});throw Error('分段文件摘要不匹配');}
    await rename(tmp,path);await rm(parts,{recursive:true,force:true});
  }finally{await rm(tmp,{force:true});}
}
async function download(path:string, sha:string, urls:string[], signal:AbortSignal, log:(message:string)=>void,bytes?:number){
  if(await digest(path).catch(()=>undefined)===sha)return;
  if(bytes){
    for(const url of urls){
      signal.throwIfAborted();
      try{log('分段下载 '+basename(path)+' · '+new URL(url).hostname);await rangedArchive(path,sha,url,bytes,signal,log);return;}
      catch(error){signal.throwIfAborted();log(String(error).slice(0,160));}
    }
  }
  for(const url of urls){
    signal.throwIfAborted();
    const temp=path+'.'+randomUUID();
    const controller=new AbortController();
    const combined=AbortSignal.any([controller.signal,signal]);
    let timer=setTimeout(()=>controller.abort(),10000);
    try{
      log('下载 '+basename(path)+' · '+new URL(url).hostname);
      const response=await fetch(url,{signal:combined});
      if(!response.ok||!response.body)throw Error('HTTP '+response.status);
      const watchdog=new Transform({transform(chunk,_encoding,done){
        clearTimeout(timer);timer=setTimeout(()=>controller.abort(),30000);done(null,chunk);
      }});
      await pipeline(response.body as any,watchdog,createWriteStream(temp,{mode:0o600,flags:'wx'}),{signal:combined});
      if(await digest(temp)!==sha)throw Error('SHA-256 不匹配');
      await rename(temp,path);return;
    }catch(error){signal.throwIfAborted();log(String(error).slice(0,220));}
    finally{clearTimeout(timer);controller.abort();await rm(temp,{force:true});}
  }
  throw Error('下载或校验失败：'+basename(path));
}
export async function prepareNative(root:string,app:DatabaseApp,signal:AbortSignal,log:(message:string)=>void){
  if(!nativeArch)throw Error('此 Linux 架构暂未适配');
  const cache=join(root,'cache'),prefix=join(root,'runtime'),marker=join(prefix,'.cagent-installed');
  await mkdir(cache,{recursive:true,mode:0o700});
  if(await stat(marker).then(v=>v.isFile(),()=>false))return prefix;
  if(app==='milvus'){
    const file='milvus_2.6.27-1_'+(nativeArch==='x64'?'amd64':'arm64')+'.deb';
    const upstream='https://github.com/milvus-io/milvus/releases/download/v2.6.27/'+file;
    await download(join(cache,file),milvusHashes[nativeArch],['https://ghfast.top/'+upstream,'https://gh-proxy.com/'+upstream,upstream],signal,log,nativeArch==='x64'?258173130:237068360);
    await mkdir(prefix,{recursive:true,mode:0o700});
    await runNative('dpkg-deb',['-x',join(cache,file),prefix],{signal,timeout:300000});
  }else{
    const platform=nativeArch==='x64'?'linux-64':'linux-aarch64';
    const micro=join(cache,'micromamba');
    const upstream='https://github.com/mamba-org/micromamba-releases/releases/download/2.5.0-2/micromamba-'+platform;
    await download(micro,microHashes[nativeArch],['https://ghfast.top/'+upstream,upstream],signal,log);
    await chmod(micro,0o700);
    const pkgs=locks[nativeArch][app];
    const entries:string[]=[];
    for(const [key,sha] of pkgs){
      const path=join(cache,basename(String(key)));
      const match=/^(.+)-([^-]+)-[^-]+$/.exec(basename(String(key)))!;
      await download(path,String(sha),[...mirrors.map(m=>m+key),'https://api.anaconda.org/download/conda-forge/'+match[1]+'/'+match[2]+'/'+key],signal,log);
      entries.push(pathToFileURL(path).href);
    }
    const spec=join(cache,'explicit.txt');await writeFile(spec,['@EXPLICIT',...entries,''].join('\n'),{mode:0o600});
    log('解包到应用专用目录');
    await runNative(micro,['create','--no-rc','--offline','--yes','--prefix',prefix,'--file',spec],{
      signal,timeout:300000,env:{...process.env,HOME:cache,XDG_CACHE_HOME:join(cache,'xdg'),MAMBA_ROOT_PREFIX:join(cache,'mamba'),MAMBA_NO_BANNER:'1'},maxBuffer:8*1024*1024,
    });
  }
  await access(join(prefix,app==='milvus'?'usr/bin/milvus':app==='redis'?'bin/redis-server':'bin/mysqld'));
  await writeFile(marker,nativeVersions[app],{mode:0o600});
  return prefix;
}
