import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

export interface Subscription {
  id: string; targets: string[]; binding: unknown; state: string; created: number;
  accountId?: string; cursor?: string; reason?: string;
}
export class WechatSubscriptions {
  private entries: Subscription[] = [];
  private active?: { id: string; child: ChildProcessWithoutNullStreams; cancelFile: string; done: Promise<void> };
  private starting = false;
  private writes = Promise.resolve();
  private waiters = new Set<() => void>();
  private changed() {for(const wake of [...this.waiters])wake();}
  async wait(id:string,cursor:string|undefined,signal:AbortSignal,milliseconds:number){
    signal.throwIfAborted();
    if(this.get(id).cursor!==cursor)return;
    await new Promise<void>((resolve,reject)=>{
      const finish=()=>{clearTimeout(timer);this.waiters.delete(finish);signal.removeEventListener('abort',abort);resolve();};
      const abort=()=>{finish();reject(signal.reason);};
      const timer=setTimeout(finish,milliseconds);
      this.waiters.add(finish);signal.addEventListener('abort',abort,{once:true});
    });
    signal.throwIfAborted();
  }
  constructor(private root: string, private python: string, private spawnChild: typeof spawn = spawn) {}
  onEvent?: (notification: {id:string;cursor:string}) => void;
  onMessage?: (notification: {id:string;cursor:string;accountId:string;event:Record<string,unknown>}) => void;
  private get file() { return join(this.root,'subscriptions.json'); }
  directory(id: string) { return join(this.root,id); }
  async load() {
    try { this.entries=JSON.parse(await readFile(this.file,'utf8')); }
    catch { this.entries=[]; }
    for(const item of this.entries) if(item.state==='listening'||item.state==='starting') {
      item.state='interrupted';item.reason='CShell restarted; live listener was not resumed';
    }
  }
  private async save() {
    this.writes=this.writes.catch(()=>{}).then(async()=>{
    await mkdir(this.root,{recursive:true});
    const temporary=this.file+'.'+randomUUID();
    await writeFile(temporary,JSON.stringify(this.entries));await rename(temporary,this.file);
    });return this.writes;
  }
  list() { return this.entries.map(x=>({...x})); }
  get(id:string) { const entry=this.entries.find(x=>x.id===id);if(!entry)throw new Error('订阅不存在');return {...entry}; }
  async start(targets:string[],binding:unknown,leaseSeconds:number,authorized:()=>boolean,signal:AbortSignal) {
    if(this.active||this.starting)throw new Error('已有微信订阅，请先停止');
    if(this.entries.length>=8)throw new Error('最多保留 8 个订阅队列，请先删除不再需要的队列');
    this.starting=true;
    try {
      signal.throwIfAborted();if(!authorized())throw new Error('订阅授权已撤销');
      const id=randomUUID(),cancelFile=join(this.root,id,'cancel');
      await mkdir(this.directory(id),{recursive:true});
      const entry:Subscription={id,targets,binding,state:'starting',created:Date.now()};
      this.entries.push(entry);await this.save();
      const env:NodeJS.ProcessEnv={...process.env,PYTHONIOENCODING:'utf-8',PYTHONDONTWRITEBYTECODE:'1'};delete env.PYTHONPATH;delete env.PYTHONHOME;
      const child=this.spawnChild(this.python,['-B','-m','cshell_wechat.subscription'],{windowsHide:true,stdio:['pipe','pipe','pipe'],env});
      let settleReady:(x:Subscription)=>void,failReady:(e:Error)=>void;
      const ready=new Promise<Subscription>((resolve,reject)=>{settleReady=resolve;failReady=reject;});
      let finish!:()=>void;
      const done=new Promise<void>(resolve=>{finish=resolve;});
      this.active={id,child,cancelFile,done};
      let pending='',closed=false,stopping=false;
      const cancel=()=>{
        if(stopping)return;stopping=true;entry.state='stopping';
        failReady(new Error('订阅已取消，正在清理探针'));
        void writeFile(cancelFile,'stop').catch(()=>{});child.stdin.end();
      };
      const startup=setTimeout(()=>{cancel();failReady(new Error('微信订阅启动超时，正在清理探针'));},45000);
      const timer=setInterval(()=>{
        if(!authorized())cancel();
        else if(!stopping&&!child.stdin.destroyed&&child.stdin.writableLength<1024)child.stdin.write('ping\n');
      },1000);
      const abort=()=>cancel();signal.addEventListener('abort',abort,{once:true});if(signal.aborted)cancel();
      const close=(reason?:string)=>{
        if(closed)return;closed=true;clearInterval(timer);clearTimeout(startup);signal.removeEventListener('abort',abort);
        entry.state='stopped';entry.reason=reason??entry.reason??'Listener ended';
        if(this.active?.id===id)this.active=undefined;
        failReady(new Error(entry.reason));void this.save().catch(()=>{});this.changed();finish();
      };
      child.on('error',()=>close('微信工具包不可用，请安装 0.1.2'));
      child.on('close',()=>close());child.stdin.on('error',()=>cancel());child.stderr.on('data',()=>{});
      child.stdout.setEncoding('utf8');
      child.stdout.on('data',chunk=>{
        pending+=chunk.toString('utf8');
        if(pending.length>1_000_000){cancel();return;}
        let index:number;
        while((index=pending.indexOf('\n'))>=0){
          const line=pending.slice(0,index);pending=pending.slice(index+1);
          try {
            const event=JSON.parse(line);
            if(!authorized()){cancel();continue;}
            if(event.type==='ready') {
              if(stopping)continue;
              clearTimeout(startup);entry.state='listening';entry.accountId=event.accountId;entry.cursor=event.cursor;
              void this.save().catch(()=>{});settleReady({...entry});
            } else if(event.type==='event') {
              entry.cursor=event.cursor;this.changed();this.onEvent?.({id,cursor:event.cursor});
              if(!stopping&&entry.state==='listening'&&entry.accountId&&event.event?.kind==='message')
                this.onMessage?.({id,cursor:event.cursor,accountId:entry.accountId,event:event.event});
            } else if(event.type==='stopped') {entry.reason=event.reason;entry.state='stopping';}
            else if(event.type==='cleanup'&&(!event.unloaded||!event.codeRestored))entry.reason='探针清理未确认，请检查微信进程';
          } catch {cancel();}
        }
      });
      child.stdin.write(JSON.stringify({binding,targets,leaseSeconds,directory:this.directory(id),cancelFile})+'\n');
      // The caller's lease covers the listener lifetime, not only startup.
      // close() removes this listener after the native child has stopped.
      return await ready;
    } finally {this.starting=false;}
  }
  async stop(id:string,purge=false) {
    this.get(id);
    const active=this.active;
    if(active?.id===id){
      await writeFile(active.cancelFile,'stop');active.child.stdin.end();
      let timer:ReturnType<typeof setTimeout>;
      try {await Promise.race([active.done,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('正在等待原生回调清理，未强制终止')),15000);})]);}
      finally {clearTimeout(timer!);}
    }
    if(purge){await rm(this.directory(id),{recursive:true,force:true});this.entries=this.entries.filter(x=>x.id!==id);}
    else {const entry=this.entries.find(x=>x.id===id)!;entry.state='stopped';}
    await this.save();return {id,stopped:true,purged:purge};
  }
  async stopAll(){if(this.active)await this.stop(this.active.id);}
}

