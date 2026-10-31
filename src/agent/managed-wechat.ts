import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, realpath, lstat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { createServer, request, type Server } from 'node:http';
import { createServer as createPortProbe } from 'node:net';
import { z } from 'zod';

const configSchema = z.object({host:z.literal('127.0.0.1'),port:z.number().int().min(1).max(65535),apiToken:z.string().min(32).max(4096),dataDir:z.string().refine(isAbsolute),permissions:z.record(z.string(),z.unknown()),subscription:z.record(z.string(),z.unknown()).optional(),webhook:z.record(z.string(),z.unknown()).optional(),tls:z.unknown().optional()});
export const managedWechatMethods = ['status','capabilities','contacts','conversations','history','moments','moment_detail','moments_interactions','send','send_file','receive','remark_read','remark_set','moments_publish','payment_parse','transfer_receive','red_packet_receive','payment_result'] as const;
export type ManagedWechatOptions = {
  executable:string; configPath:string; files:Record<string,string>; authorize:()=>boolean;
  /** Dependency injection is private to the backend; never accepted from an extension manifest. */
  launch?:(file:string,args:string[])=>ChildProcess; startupTimeoutMs?:number; stopTimeoutMs?:number;
};

/** A verified, explicitly authorized local service. No install, permission mutation or operation replay. */
export class ManagedWechatService {
  private child?:ChildProcess;
  private config?:z.infer<typeof configSchema>;
  private pending?:Promise<void>;
  constructor(private readonly options:ManagedWechatOptions) {}
  private guard(){if(!this.options.authorize())throw Error('WECHAT_SERVICE_NOT_AUTHORIZED');}
  private launch(args:string[]){return this.options.launch?.(this.options.executable,args)??spawn(this.options.executable,args,{windowsHide:true,stdio:'ignore',cwd:dirname(this.options.executable),shell:false});}
  async verify(){
    const root=await realpath(dirname(this.options.executable));
    if(!isAbsolute(this.options.executable)||!isAbsolute(this.options.configPath)||!Object.keys(this.options.files).length)throw Error('WECHAT_PACKAGE_INVALID');
    let executableVerified=false;
    for(const [name,digest] of Object.entries(this.options.files)){
      if(!/^[a-f0-9]{64}$/.test(digest)||isAbsolute(name))throw Error('WECHAT_PACKAGE_INVALID');
      const path=resolve(root,name),within=relative(root,path);
      if(within.startsWith('..')||isAbsolute(within)||(await lstat(path)).isSymbolicLink()||await realpath(path)!==path)throw Error('WECHAT_PACKAGE_INVALID');
      const h=createHash('sha256');for await(const b of createReadStream(path))h.update(b);
      if(h.digest('hex')!==digest)throw Error('WECHAT_PACKAGE_DIGEST_MISMATCH');
      if(path===resolve(this.options.executable))executableVerified=true;
    }
    if(!executableVerified)throw Error('WECHAT_EXECUTABLE_UNVERIFIED');
  }
  async start(){
    if(this.pending)return this.pending;
    this.pending=this.startOwned().finally(()=>{this.pending=undefined;});return this.pending;
  }
  private async startOwned(){
    this.guard();if(this.child&&this.child.exitCode===null){await this.health();return;}
    await this.verify();
    const info=await lstat(this.options.configPath);if(!info.isFile()||info.isSymbolicLink()||info.size>131072)throw Error('WECHAT_CONFIG_INVALID');
    const cfg=configSchema.parse(JSON.parse(await readFile(this.options.configPath,'utf8')));
    // Managed transport never opens a LAN listener, changes TLS policy or generates credentials.
    if(cfg.tls)throw Error('WECHAT_MANAGED_TRANSPORT_REQUIRES_LOOPBACK_HTTP');
    // Do not adopt an independently running listener and later stop somebody else's service.
    const probe=createPortProbe();await new Promise<void>((ok,fail)=>{probe.once('error',()=>fail(Error('WECHAT_PORT_IN_USE')));probe.listen(cfg.port,'127.0.0.1',()=>probe.close(()=>ok()));});
    this.guard();this.config=cfg;
    const child=this.launch(['--serve','--config',this.options.configPath]);this.child=child;
    let failed=false;child.once('error',()=>{failed=true;if(this.child===child){this.child=undefined;this.config=undefined;}});
    const until=Date.now()+(this.options.startupTimeoutMs??15000);
    try{while(Date.now()<until){this.guard();if(failed||child.exitCode!==null)throw Error('WECHAT_SERVICE_START_FAILED');try{await this.health();return;}catch{if(failed||child.exitCode!==null)break;}await new Promise(r=>setTimeout(r,100));}throw Error('WECHAT_SERVICE_NOT_READY');}
    catch(error){if(!failed)await this.stopOwned();throw error;}
  }
  async stop(){if(this.pending)await this.pending.catch(()=>{});await this.stopOwned();}
  private async stopOwned(){
    const owned=this.child;if(!owned)return;
    if(owned.exitCode!==null){this.child=undefined;this.config=undefined;return;}
    // The executable uses its same-user named event. Never kill WeChat or force native hook teardown.
    await this.verify();const stopper=this.launch(['--stop','--config',this.options.configPath]);
    let error=false;stopper.once('error',()=>{error=true;});
    const until=Date.now()+(this.options.stopTimeoutMs??15000);
    while(owned.exitCode===null&&Date.now()<until&&!error)await new Promise(r=>setTimeout(r,50));
    if(owned.exitCode===null)throw Error('WECHAT_SERVICE_STOP_UNCONFIRMED');
    this.child=undefined;this.config=undefined;
  }
  private async call(path:string,body?:unknown):Promise<unknown>{
    this.guard();const cfg=this.config;if(!cfg||!this.child||this.child.exitCode!==null)throw Error('WECHAT_SERVICE_NOT_RUNNING');
    const payload=body===undefined?undefined:Buffer.from(JSON.stringify(body));if(payload&&payload.length>131072)throw Error('WECHAT_REQUEST_TOO_LARGE');
    return new Promise((ok,fail)=>{
      const req=request({host:'127.0.0.1',port:cfg.port,path,method:payload?'POST':'GET',agent:false,headers:{Authorization:'Bearer '+cfg.apiToken,...(payload?{'Content-Type':'application/json','Content-Length':payload.length}:{})}},res=>{
        let bytes=0;const chunks:Buffer[]=[];res.on('data',(b:Buffer)=>{bytes+=b.length;if(bytes>2*1024*1024)req.destroy(Error('WECHAT_RESPONSE_TOO_LARGE'));else chunks.push(b);});
        res.on('end',()=>{try{this.guard();if(res.statusCode!==200&&res.statusCode!==202)throw Error('WECHAT_HTTP_'+res.statusCode);ok(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch(e){fail(e);}});
        res.on('error',()=>fail(Error('WECHAT_RESPONSE_INTERRUPTED')));
      });
      const timer=setTimeout(()=>req.destroy(Error('WECHAT_HTTP_TIMEOUT')),10000);timer.unref();req.once('close',()=>clearTimeout(timer));req.once('error',()=>fail(Error('WECHAT_TRANSPORT_FAILED')));req.end(payload);
    });
  }
  health(){return this.call('/v1/health');}
  capabilities(){return this.call('/v1/capabilities');}
  submit(method:string,params:Record<string,unknown>,idempotencyKey:string){
    if(!managedWechatMethods.includes(method as typeof managedWechatMethods[number])||!params||Array.isArray(params)||!/^[\x21-\x7e]{8,128}$/.test(idempotencyKey))throw Error('WECHAT_OPERATION_INVALID');
    return this.call('/v1/operations',{method,params,idempotencyKey});
  }
  operation(id:string){if(!/^[a-f0-9]{32}$/.test(id))throw Error('WECHAT_OPERATION_ID_INVALID');return this.call('/v1/operations/'+id);}
  events(after=0,limit=50){if(!Number.isSafeInteger(after)||after<0||!Number.isInteger(limit)||limit<1||limit>100)throw Error('WECHAT_CURSOR_INVALID');return this.call('/v1/events?after='+after+'&limit='+limit);}
}

const eventSchema=z.object({id:z.string().regex(/^[a-f0-9]{32}$/),version:z.literal(1),type:z.enum(['message.received','payment.transfer','payment.red_packet','subscription.gap','operation.completed']),time:z.number().int(),data:z.record(z.string(),z.unknown())}).strict();
export type ManagedWechatEvent={trust:'untrusted';event:z.infer<typeof eventSchema>};
/** Authenticated callbacks remain third-party data, never instructions or authority. */
export class ManagedWechatCallbacks {
  private server?:Server;
  private readonly seen=new Map<string,number>();
  private readonly active=new Set<string>();
  constructor(private readonly options:{secret:string;authorize:()=>boolean;onEvent:(event:ManagedWechatEvent)=>Promise<void>;now?:()=>number}){if(options.secret.length<32)throw Error('WECHAT_CALLBACK_SECRET_INVALID');}
  async start(){
    if(this.server)throw Error('WECHAT_CALLBACK_ALREADY_STARTED');
    const server=createServer(async(req,res)=>{
      const reply=(code:number)=>{res.writeHead(code,{'Cache-Control':'no-store'});res.end();};
      if(!this.options.authorize()){reply(403);return;}
      if(req.method!=='POST'||req.url!=='/wechat/events'){reply(404);return;}
      const length=Number(req.headers['content-length']);if(!Number.isInteger(length)||length<1||length>131072||req.headers['transfer-encoding']){reply(413);return;}
      const id=req.headers['x-event-id'],stamp=req.headers['x-event-timestamp'],signature=req.headers['x-event-signature'];
      const now=(this.options.now??Date.now)();
      if(typeof id!=='string'||!/^[a-f0-9]{32}$/.test(id)||typeof stamp!=='string'||!/^\d{10}$/.test(stamp)||Math.abs(now/1000-Number(stamp))>300||typeof signature!=='string'||!/^sha256=[a-f0-9]{64}$/.test(signature)){reply(401);return;}
      try{
        let bytes=0;const chunks:Buffer[]=[];for await(const b of req){bytes+=b.length;if(bytes>131072){reply(413);return;}chunks.push(b);}
        const body=Buffer.concat(chunks);if(bytes!==length){reply(400);return;}
        const expected=createHmac('sha256',this.options.secret).update(stamp+'.'+id+'.').update(body).digest();
        if(!timingSafeEqual(expected,Buffer.from(signature.slice(7),'hex'))){reply(401);return;}
        const event=eventSchema.parse(JSON.parse(body.toString('utf8')));if(event.id!==id){reply(400);return;}
        if(this.seen.has(id)){reply(204);return;}if(this.active.has(id)||this.active.size>=8){reply(503);return;}
        for(const [key,time]of this.seen)if(now-time>86400000)this.seen.delete(key);
        // Refuse new deliveries when full rather than forgetting recent IDs and replaying them.
        if(this.seen.size>=10000){reply(503);return;}
        this.active.add(id);try{if(!this.options.authorize()){reply(403);return;}await this.options.onEvent({trust:'untrusted',event});this.seen.set(id,now);reply(204);}finally{this.active.delete(id);}
      }catch{if(!res.headersSent)reply(400);}
    });
    server.requestTimeout=10000;server.headersTimeout=5000;server.maxConnections=16;
    await new Promise<void>((ok,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',ok);});this.server=server;const address=server.address();if(!address||typeof address==='string')throw Error('WECHAT_CALLBACK_BIND_FAILED');return 'http://127.0.0.1:'+address.port+'/wechat/events';
  }
  async stop(){const server=this.server;this.server=undefined;if(server){server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}}
}
