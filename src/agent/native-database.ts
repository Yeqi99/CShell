import { randomBytes,randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { cp, mkdir, open, readFile, readlink, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createServer,connect } from 'node:net';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { DatabaseApp } from '../shared/database-apps';
import { prepareNative,runNative } from './native-database-install';

interface Instance {port:number;pid:number;start:string;binary:string}
async function state(root:string):Promise<Instance|undefined>{
  try{return JSON.parse(await readFile(join(root,'instance.json'),'utf8'));}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}
}
export async function nativePort(root:string){return (await state(root))?.port;}
async function processStart(pid:number){
  const info=await readFile('/proc/'+pid+'/stat','utf8');
  return info.slice(info.lastIndexOf(')')+2).split(' ')[19];
}
async function owned(root:string,instance:Instance){
  try{
    if(await processStart(instance.pid)!==instance.start || await readlink('/proc/'+instance.pid+'/exe')!==instance.binary)return false;
    const cwd=await readlink('/proc/'+instance.pid+'/cwd'),dir=await realpath(root);
    return cwd===dir || cwd===join(dir,'data');
  }catch{return false;}
}
async function stop(root:string,instance:Instance){
  if(!await owned(root,instance))return;
  process.kill(instance.pid,'SIGTERM');
  for(let i=0;i<200;i++){if(!await owned(root,instance))return;await delay(100);}
  throw Error('原实例仍在退出，请稍后重试');
}
async function reserve(port:number){
  const server=createServer();
  return new Promise<number>((ok,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',()=>{const actual=(server.address() as {port:number}).port;server.close(()=>ok(actual));});});
}
async function secret(file:string){
  try{await writeFile(file,randomBytes(24).toString('hex'),{flag:'wx',mode:0o600});}
  catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
  return (await readFile(file,'utf8')).trim();
}
async function healthy(app:DatabaseApp,root:string,port:number){
  if(app==='milvus'){
    const response=await fetch('http://127.0.0.1:'+port+'/v2/vectordb/collections/list',{method:'POST',headers:{Authorization:'Bearer root:'+await readFile(join(root,'root-password'),'utf8'),'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(1800)});
    return response.ok && (await response.json() as {code:number}).code===0;
  }
  return new Promise<boolean>((done)=>{
    const socket=connect(port,'127.0.0.1');
    const finish=(value:boolean)=>{socket.destroy();done(value);};
    socket.setTimeout(1500,()=>finish(false));
    socket.once('error',()=>finish(false));socket.once('end',()=>finish(false));
    socket.once('connect',()=>{if(app==='redis')socket.write('PING\r\n');});
    socket.once('data',data=>finish(app==='redis'?data.toString().startsWith('+PONG'):data.length>5&&data[4]===10));
  });
}
async function launch(root:string,prefix:string,app:DatabaseApp,port:number,signal:AbortSignal,log:(s:string)=>void){
  const data=join(root,'data');
  const env={...process.env};
  await mkdir(data,{recursive:true,mode:0o700});
  let binary:string,args:string[];
  if(app==='redis'){
    binary=join(prefix,'bin/redis-server');
    args=['--bind','127.0.0.1','--port',String(port),'--dir',data,'--appendonly','yes','--daemonize','no'];
  }else if(app==='mysql'){
    binary=join(prefix,'bin/mysqld');
    args=['--no-defaults','--basedir='+prefix,'--datadir='+data,...(process.getuid?.()===0?['--user=root']:[])];
    const password=await secret(join(root,'root-password'));
    const sql=join(root,'initial-account.sql');
    if(!await stat(join(data,'mysql')).catch(()=>undefined)){
      const init=join(root,'initial-data-'+randomUUID());
      await mkdir(init,{mode:0o700});
      try{
        await runNative(binary,[...args,'--datadir='+init,'--initialize-insecure'],{signal,timeout:180000});
        await writeFile(sql,"ALTER USER 'root'@'localhost' IDENTIFIED BY '"+password+"';\n",{mode:0o600});
        await rename(init,data);
      }finally{await rm(init,{force:true,recursive:true});}
    }
    if(await stat(sql).catch(()=>undefined))args.push('--init-file='+sql);
    args.push('--socket=mysql.sock','--port='+port,'--bind-address=127.0.0.1','--mysqlx=OFF','--pid-file='+join(data,'mysql.pid'));
  }else{
    binary=join(prefix,'usr/bin/milvus');args=['run','standalone'];
    const cfg=join(root,'configs'),pass=await secret(join(root,'root-password'));
    await cp(join(prefix,'etc/milvus/configs'),cfg,{recursive:true});
    const etcd=await reserve(0),peer=await reserve(0);
    const privateEtcd='http://127.0.0.1:'+etcd,privatePeer='http://127.0.0.1:'+peer;
    await writeFile(join(cfg,'embedEtcd.yaml'),[
      'listen-client-urls: '+privateEtcd,'advertise-client-urls: '+privateEtcd,'listen-peer-urls: '+privatePeer,'initial-advertise-peer-urls: '+privatePeer,'initial-cluster: default='+privatePeer,'quota-backend-bytes: 4294967296',
    ].join('\n')+'\n');
    const conf=join(cfg,'milvus.yaml');
    const yaml=(await readFile(conf,'utf8')).replaceAll('/var/lib/milvus',data).replaceAll('/etc/milvus/configs',cfg)
      .replace(/^  ip: *#.*$/gm,'  ip: 127.0.0.1').replace(/^  port: 19530\b/m,'  port: '+port)
      .replace('authorizationEnabled: false','authorizationEnabled: true').replace('defaultRootPassword: Milvus','defaultRootPassword: "'+pass+'"');
    await writeFile(conf,yaml,{mode:0o600});
    Object.assign(env,{MILVUSCONF:cfg,DEPLOY_MODE:'STANDALONE',ETCD_USE_EMBED:'true',ETCD_ENDPOINTS:privateEtcd,ETCD_DATA_DIR:join(data,'etcd'),ETCD_CONFIG_PATH:join(cfg,'embedEtcd.yaml'),COMMON_STORAGETYPE:'local',METRICS_PORT:'-1',LD_LIBRARY_PATH:join(prefix,'usr/lib/milvus'),GOMAXPROCS:'2',OMP_NUM_THREADS:'2',MALLOC_ARENA_MAX:'2'});
  }
  const logfile=join(root,'server.log'),out=await open(logfile,'a',0o600),offset=(await out.stat()).size;
  signal.throwIfAborted();
  const child=spawn(binary,args,{cwd:root,env,detached:true,stdio:['ignore',out.fd,out.fd]});
  const started=new Promise<void>((ok,fail)=>{child.once('error',fail);child.once('spawn',ok);});
  await out.close();await started;
  const pid=child.pid!;
  child.unref();
  try{
    const identity:Instance={pid,port,binary:await realpath(binary),start:await processStart(pid)};
    for(let i=0;i<240;i++){
      signal.throwIfAborted();
      if(child.exitCode!==null||child.signalCode)throw Error('数据库进程已退出');
      if(await healthy(app,root,port).catch(()=>false)){
        const temp=join(root,'state-'+randomUUID());await writeFile(temp,JSON.stringify(identity),{mode:0o600});await rename(temp,join(root,'instance.json'));
        if(app==='mysql')await rm(join(root,'initial-account.sql'),{force:true});
        log('服务已就绪：127.0.0.1:'+port);if(app!=='redis')log('本机 root 密码文件：'+join(root,'root-password'));return;
      }
      await delay(500,undefined,{signal});
    }
    throw Error('数据库健康检查超时');
  }catch(error){
    if(child.exitCode===null&&!child.signalCode){child.kill('SIGTERM');for(let i=0;i<100&&child.exitCode===null&&!child.signalCode;i++)await delay(100);if(child.exitCode===null&&!child.signalCode)child.kill('SIGKILL');}
    const f=await open(logfile,'r');try{const size=(await f.stat()).size,start=Math.max(offset,size-2400);const b=Buffer.alloc(size-start);await f.read(b,0,b.length,start);log(b.toString().slice(-2200));}finally{await f.close();}
    throw error;
  }
}
async function changeNative(root:string,app:DatabaseApp,port:number,signal:AbortSignal,log:(s:string)=>void){
  await mkdir(root,{recursive:true,mode:0o700});
  const old=await state(root),running=!!old&&await owned(root,old);
  if(running&&old.port===port&&await healthy(app,root,port).catch(()=>false)){log('实例已运行：127.0.0.1:'+port);return;}
  if(!running||old.port!==port)await reserve(port);
  const prefix=await prepareNative(root,app,signal,log);
  signal.throwIfAborted();
  if(running)await stop(root,old);
  try{await launch(root,prefix,app,port,signal,log);}
  catch(error){
    if(running && old.port!==port && !signal.aborted){log('尝试恢复原端口 '+old.port);await launch(root,prefix,app,old.port,signal,log);}
    throw error;
  }
}

const operations=new Map<string,Promise<void>>();
export async function installNative(root:string,app:DatabaseApp,port:number,signal:AbortSignal,log:(s:string)=>void){
  while(operations.has(root))await operations.get(root)?.catch(()=>{});
  signal.throwIfAborted();
  const task=changeNative(root,app,port,signal,log);
  operations.set(root,task);
  try{await task;}finally{operations.delete(root);}
}
export async function restoreNative(root:string,app:DatabaseApp,signal:AbortSignal){
  const saved=await state(root);
  if(!saved||await owned(root,saved))return;
  await installNative(root,app,saved.port,signal,()=>{});
}
