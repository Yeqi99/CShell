import { permissionHref } from '../shared/permission-links';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile,writeFile,mkdir,unlink,rename } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { WechatSubscriptions } from './wechat-subscriptions';
import type { Store } from './store';
import type { ConnectionTool } from './connections/contracts';
import { pluginEnabled } from '../shared/plugins';
import { wechatEventTypes } from '../shared/wechat-events';
import { emptyWechatConfig,wechatConfigSchema,wechatTargetSchema,wechatFriendSchema,parseWechatConfig } from '../shared/wechat';

export class WechatService {
  private config=emptyWechatConfig();
  private binding: unknown=null;
  private busy=false;
  private revision=0;
  readonly subscriptions:WechatSubscriptions;
  constructor(private directory:string,private store:Pick<Store,'plugins'>,private options:{python?:string;enabled?:()=>boolean}={}){this.subscriptions=new WechatSubscriptions(join(directory,'wechat-subscriptions'),(this.options.python??join(process.env.LOCALAPPDATA??'','CShell','tools','wechat-bridge','venv','Scripts','python.exe')));}
  private isEnabled(){return this.options.enabled?.()??pluginEnabled(this.store.plugins(),'wechat');}
  configured(){return this.config.enabled&&this.config.experimental&&!!this.binding;}
  async ready(){
    if(!this.configured())return false;
    const data=await this.run({method:'discover'},new AbortController().signal);
    return data.processes.some((process:any)=>JSON.stringify(process.binding)===JSON.stringify(this.binding));
  }
  private get file(){return join(this.directory,'wechat.json');}
  async load(){try{const data=JSON.parse(await readFile(this.file,'utf8'));this.config=wechatConfigSchema.parse(data.config);this.binding=data.binding;}catch{this.config=emptyWechatConfig();}await this.subscriptions.load();}
  private requirePlugin(){if(process.platform!=='win32')throw new Error('微信控制目前仅支持 Windows');if(!this.isEnabled())throw new Error('请先安装并启用微信扩展');}
  async status(){this.requirePlugin();try{const result=await this.run({method:'discover'},new AbortController().signal);return {config:this.config,processes:result.processes,subscriptions:this.subscriptions.list().map(({id,state,reason})=>({id,state,reason}))};}catch(error){return {config:this.config,processes:[],error:String(error)};}}
  async save(input:unknown){
    this.requirePlugin();if(this.busy)throw new Error('请先停止正在进行的微信操作');
    const config=parseWechatConfig(input);
    await this.subscriptions.stopAll();
    let binding:unknown=null;
    if(config.enabled){
      if(!config.experimental||!config.pid)throw new Error('请选择微信进程并确认实验风险');
      const data=await this.run({method:'discover'},new AbortController().signal);
      binding=data.processes.find((p:any)=>p.pid===config.pid)?.binding;
      if(!binding)throw new Error('找不到此版本的微信进程，请刷新');
    }
    this.requirePlugin();await mkdir(this.directory,{recursive:true});
    const temp=this.file+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify({config,binding}));await rename(temp,this.file);
    this.config=config;this.binding=binding;this.revision++;
  }
  tools():ConnectionTool[]{
    if(!this.isEnabled()||process.platform!=='win32')return [];
    const tool=(name:string,method:string,capability:string,input:z.ZodType,description:string,review=false):ConnectionTool=>({
      name,capability,input,description,needsReview:()=>review,
      invoke:async(args,signal)=>JSON.stringify(await this.invoke(method,args,signal)),
    });
    return [
      tool('wechat_moment_detail','moment_detail','wechat.read',z.object({postId:z.string().regex(/^[0-9]{1,20}$/),limit:z.number().int().min(1).max(50).default(20),cursor:z.string().max(1024).optional()}).strict(),'Read one exact locally cached Moment and its cached likes, comments and reply references without opening UI. Requires readMoments. Follow nextCursor; if the account or cached post changes, restart paging. Not a complete server comment list; no server refresh. locallyAdded is not delivery confirmation. Keeps 32-bit and 64-bit comment ID namespaces distinct. Does not send any interaction.'),
      tool('wechat_send_file','send_file','wechat.send',z.object({recipient:wechatTargetSchema,path:z.string().min(1).max(32767).refine(s=>!s.includes('\0')),idempotencyKey:z.string().regex(/^[A-Za-z0-9_-]{8,128}$/)}).strict(),'Send one real file from THIS computer through its bound WeChat. path is an absolute local file on the target machine, never the controller machine. Requires sendFiles plus recipient send grant; sendBlocked wins. File size 1 byte to 128 MiB. Copies a stable snapshot before native upload. Use the SAME idempotency key on retries; never retry unknown outcomes with a new key. native_returned does not confirm upload or recipient delivery. Retains staged files for asynchronous upload (512 MiB / 64 files budget). Experimental exact-build adapter.',true),
      tool('wechat_subscribe','subscribe','wechat.read',z.object({targets:z.array(z.union([wechatTargetSchema,z.literal('*')])).min(1).max(100),leaseSeconds:z.number().int().min(10).max(86400).default(3600)}).strict(),'Start a persistent local message subscription for exact conversations or * only when receive * is granted. Pushes event notifications to CShell; consume with wechat_events. Binds current process/account; stops on revocation, parent exit or lease expiry. Does NOT auto-reply or auto-resume after restart; gaps are explicit. At most one active listener; durable bounded queues retain 7 days/10000 events. Save subscription ID and cursor.',true),
      tool('wechat_subscriptions','subscriptions','wechat.read',z.object({}).strict(),'List locally authorized subscription queues and listener status. No messages are sent.'),
      tool('wechat_events','events','wechat.read',z.object({subscriptionId:z.string().uuid(),cursor:z.string().max(100).optional(),limit:z.number().int().min(1).max(100).default(50),waitSeconds:z.number().int().min(0).max(30).default(0)}).strict(),'Read durable subscription events after cursor, optionally wait for push up to 30 seconds. Store nextCursor only after processing. Duplicate delivery after consumer failure is possible; dedupe by message ID and conversation. Inspect gap/status; no automatic history replay. Each queue belongs to its original process binding and target grants.'),
      tool('wechat_unsubscribe','unsubscribe','wechat.read',z.object({subscriptionId:z.string().uuid(),purge:z.boolean().default(false)}).strict(),'Stop a subscription and drain its native callback. Optionally purge its local event queue. Does not send or delete WeChat messages.',true),
      tool('wechat_status','status','wechat.read',z.object({}).strict(),'Inspect WeChat on THIS Windows computer, independent of the conversation remote machine. Shows exact supported processes and local grant settings.'),
      tool('wechat_get_remark','remark_read','wechat.read',z.object({target:z.string().regex(/^wxid_[A-Za-z0-9_]{3,64}$/)}).strict(),'Read the current local remark for one remark-authorized individual (saved remarks * allows all individuals; target must be an exact wxid). Read before requesting a change. Does not enumerate contacts or confirm server persistence.'),
      tool('wechat_set_remark','remark_set','wechat.contacts.manage',z.object({target:z.string().regex(/^wxid_[A-Za-z0-9_]{3,64}$/),remark:z.string().max(64).refine(s=>Buffer.byteLength(s,'utf8')<=128&&!/[\x00-\x1f\x7f]/.test(s)),expectedRemark:z.string().max(64).refine(s=>Buffer.byteLength(s,'utf8')<=128&&!/[\x00-\x1f\x7f]/.test(s)),idempotencyKey:z.string().regex(/^[A-Za-z0-9_-]{8,128}$/)}).strict(),'A saved remarks * allows all individuals but target must be one exact wxid. Set an authorized individual contact remark on THIS computer. First read with wechat_get_remark and provide exact expectedRemark; conflict means no change submitted. Empty remark clears it. Native return is not server confirmation; read back and report uncertainty. Not atomic against other devices. Never retry unknown outcomes with a new key. Experimental native adapter may crash WeChat.',true),
      tool('wechat_publish_moment','moments_publish','wechat.send',z.object({text:z.string().min(1).refine(s=>Buffer.byteLength(s,'utf8')<=512),visibility:z.literal('public'),idempotencyKey:z.string().regex(/^[A-Za-z0-9_-]{8,128}$/)}).strict(),'Publish one real plain-text Moment on this computer. Requires independent publishMoments grant; chat send * does not grant it. public means non-private with no per-post groups; account privacy still applies. No images or videos. Reuse the same idempotency key after interruptions. NEVER retry an unknown outcome with a new key. Only publicationConfirmed=true with status confirmed proves a new matching own timeline record with a server ID. Experimental exact-build adapter.',true),
      tool('wechat_moment_interactions','moments_interactions','wechat.read',z.object({postId:z.string().regex(/^[0-9]{1,20}$/),limit:z.number().int().min(1).max(5).default(5),cursor:z.string().max(1024).optional()}).strict(),'Read cached like/comment notifications for one exact unsigned server post ID. Requires readMoments. This is NOT the full comment list and does not refresh the server. Follow nextCursor; scope is bound to this account and post. Like/comment ID namespaces are distinct. Inspect contentStatus and deletionState. Does not send or mark notifications read.'),
      tool('wechat_moments','moments','wechat.read',z.object({limit:z.number().int().min(1).max(5).default(5),cursor:z.string().max(1024).optional()}).strict(),'Read locally cached Moments without opening UI. Requires separate readMoments grant. Does NOT refresh from server or publish. Follow nextCursor while hasMore; native ID order is not verified chronological order. Reports bounded persistent observed/updated changes only for this page, not a complete incremental feed. Restart paging to detect edits; missing records do not prove deletion. Media metadata only; inspect contentStatus for omitted or malformed records.'),
      tool('wechat_recent_conversations','conversations','wechat.read',z.object({limit:z.number().int().min(1).max(100).default(50),cursor:z.string().max(2048).optional(),includeHidden:z.boolean().default(false)}).strict(),'Read recent conversation metadata from the local session database without opening UI or marking messages read. Requires separate readSessions grant. Returns exact conversation IDs, unread counts and activity timestamps, without message content. Follow nextCursor while hasMore. Client sort value is opaque; do not infer pin status or send authorization. Refresh and dedupe by conversationId when concurrent messages reorder pages.'),
      tool('wechat_contacts','contacts','wechat.read',z.object({limit:z.number().int().min(1).max(100).default(50),cursor:z.string().max(2048).optional()}).strict(),'Actively read local contact database records without opening the address book UI. Follow nextCursor while hasMore; records may include groups, deleted and non-friend entries. Not a snapshot or verified friend count. Never infer a unique recipient from a nickname. Experimental native adapter can crash WeChat.'),
      tool('wechat_send_text','send','wechat.send',z.object({recipient:wechatTargetSchema,text:z.string().min(1).max(4096),idempotencyKey:z.string().regex(/^[A-Za-z0-9_-]{8,128}$/)}).strict(),'Send one real text through locally bound WeChat to an allowed internal ID or filehelper. A saved * send grant allows all valid recipients; sendBlocked always denies matching IDs. The recipient argument must be one exact ID, never *. Never retry unknown outcomes with a new key. native_returned is not delivery confirmation. Experimental; may crash WeChat.',true),
      tool('wechat_receive','receive','wechat.read',z.object({targets:z.array(wechatTargetSchema).min(1).max(20),seconds:z.number().int().min(1).max(30).default(15)}).strict(),'A saved receive * grants any exact ID, not an unfiltered global listener. Supply 1–20 exact targets. Listen for new messages from allowed IDs on THIS computer for up to 30 seconds; no history replay. Experimental; may crash WeChat.'),
      tool('wechat_history','history','wechat.read',z.object({target:wechatTargetSchema,limit:z.number().int().min(1).max(30).default(20),direction:z.enum(['latest','before','after']).default('latest'),cursor:z.string().max(2048).optional()}).strict(),'Actively read local WeChat message_0.db history without opening or scrolling the conversation UI, for one exact target allowed by history grants (including saved *). Never pass * as target. Use olderCursor with before, newerCursor with after; save the cursor after processing and deduplicate by deduplicationKey after restart. Rebind the process after restart. Other database shards and remote/deleted history are NOT covered; inspect gap, complete and contentStatus. No automatic sending or background sync. Experimental native adapter can crash WeChat.'),
    ];
  }
  async subscribeAuthorized(args:any,signal:AbortSignal,authorize:()=>boolean){return JSON.stringify(await this.invoke('subscribe',args,signal,authorize));}
  eventSource(){
    if(process.platform!=='win32'||!this.isEnabled())return null;
    const available=this.config.enabled&&this.config.experimental&&!!this.binding;
    return {id:'wechat',name:'微信',eventTypes:wechatEventTypes(),available,...(!available?{reason:'请先在微信扩展中绑定进程并开启接收授权'}:{})};
  }
  eventAuthorized(subscriptionId:string,accountId:string,conversationId:string){
    try{
      const item=this.subscriptions.get(subscriptionId);
      return !!this.eventSource()?.available&&item.state==='listening'&&item.accountId===accountId
        &&JSON.stringify(item.binding)===JSON.stringify(this.binding)
        &&(this.config.receive.includes('*')||this.config.receive.includes(conversationId))
        &&(item.targets.includes('*')||item.targets.includes(conversationId));
    }catch{return false;}
  }
  async startEventListener(input:unknown,signal:AbortSignal){
    const args=z.object({targets:z.array(z.union([wechatTargetSchema,z.literal('*')])).min(1).max(100),leaseSeconds:z.number().int().min(10).max(86400).default(3600)}).strict().parse(input);
    return this.invoke('subscribe',args,signal);
  }
  private async invoke(method:string,args:any,signal:AbortSignal,persistentGuard:()=>boolean=()=>true){
    this.requirePlugin();if(method==='status')return this.status();
    const permitted=(targets:string[],binding:unknown)=>this.config.enabled&&this.config.experimental&&this.isEnabled()&&JSON.stringify(binding)===JSON.stringify(this.binding)&&targets.every(id=>this.config.receive.includes('*')||this.config.receive.includes(id));
    if(method==='subscriptions')return this.subscriptions.list().filter(x=>permitted(x.targets,x.binding));
    if(method==='unsubscribe')return this.subscriptions.stop(args.subscriptionId,args.purge);
    if(method==='events'){
      const item=this.subscriptions.get(args.subscriptionId);
      const authorized=()=>permitted(item.targets,item.binding);
      if(!authorized())throw new Error('订阅范围已撤权或绑定已改变');
      const deadline=Date.now()+(args.waitSeconds??0)*1000;
      while(true){
        signal.throwIfAborted();if(!authorized())throw new Error('订阅授权已撤销');
        const observed=this.subscriptions.get(item.id).cursor;
        const page=await this.run({method:'events',directory:this.subscriptions.directory(item.id),params:args},signal,authorized);
        if(!authorized())throw new Error('订阅授权已撤销');
        const state=this.subscriptions.get(item.id).state;
        if(page.events.length||Date.now()>=deadline||state!=='listening')return {...page,gap:page.gap||state==='interrupted',listenerState:state};
        await this.subscriptions.wait(item.id,observed,signal,Math.max(0,deadline-Date.now()));
      }
    }
    if(this.busy)throw new Error('微信已有操作在运行');
    if(!this.config.enabled||!this.config.experimental||!this.binding)throw new Error(`请在微信扩展中绑定进程并启用实验控制。[前往授权](${permissionHref('wechat/pid')})`);
    if(method==='subscribe'){
      if(args.targets.includes('*')&&args.targets.length!==1)throw new Error('* 需单独使用');
      const binding=this.binding,revision=this.revision;
      const authorized=()=>persistentGuard()&&revision===this.revision&&permitted(args.targets,binding);
      if(!authorized())throw new Error(`订阅目标不在接收授权范围。[前往授权](${permissionHref('wechat/receive')})`);
      const runtime=await this.run({method:'discover'},signal,authorized);
      if(runtime.subscriptionProtocolVersion!==1)throw new Error('请先安装微信工具包 0.1.2');
      return this.subscriptions.start(args.targets,binding,args.leaseSeconds??3600,authorized,signal);
    }
    if(method==='moments_publish'&&!this.config.publishMoments)throw new Error(`未授权发布朋友圈。[前往授权](${permissionHref('wechat/publishMoments')})`);
    if((method==='moments'||method==='moments_interactions'||method==='moment_detail')&&!this.config.readMoments)throw new Error(`未授权读取朋友圈缓存。[前往授权](${permissionHref('wechat/readMoments')})`);
    if(method==='conversations'&&!this.config.readSessions)throw new Error(`未授权读取最近会话。[前往授权](${permissionHref('wechat/readSessions')})`);
    if(method==='contacts'&&!this.config.readContacts)throw new Error(`未授权读取联系人。[前往授权](${permissionHref('wechat/readContacts')})`);
    if(method==='send_file'&&!this.config.sendFiles)throw new Error(`未授权发送文件。[前往授权](${permissionHref('wechat/sendFiles')})`);
    if(method==='send'||method==='send_file'){
      wechatTargetSchema.parse(args.recipient);
      if(this.config.sendBlocked.includes(args.recipient))throw new Error(`收件人在微信发送黑名单中。[前往授权](${permissionHref('wechat/sendBlocked')})`);
      if(!this.config.send.includes('*')&&!this.config.send.includes(args.recipient))throw new Error(`收件人不在微信发送授权列表。[前往授权](${permissionHref('wechat/send')})`);
    }
    if(method==='receive'){
      z.array(wechatTargetSchema).min(1).max(20).parse(args.targets);
      if(!this.config.receive.includes('*')&&args.targets.some((id:string)=>!this.config.receive.includes(id)))throw new Error(`接收目标不在授权列表。[前往授权](${permissionHref('wechat/receive')})`);
    }
    if(method==='history'){
      wechatTargetSchema.parse(args.target);
      if(!this.config.history.includes('*')&&!this.config.history.includes(args.target))throw new Error(`历史读取目标不在授权列表。[前往授权](${permissionHref('wechat/history')})`);
    }
    if(method.startsWith('remark_')){
      wechatFriendSchema.parse(args.target);
      if(!this.config.remarks.includes('*')&&!this.config.remarks.includes(args.target))throw new Error(`联系人不在微信备注授权列表。[前往授权](${permissionHref('wechat/remarks')})`);
    }
    const revision=this.revision;this.busy=true;
    const authorized=()=>revision===this.revision&&this.isEnabled()&&this.config.enabled;
    try{
      if(method==='send_file'){
        const runtime=await this.run({method:'discover'},signal,authorized);
        if(runtime.fileSendProtocolVersion!==1)throw new Error('请先安装支持文件发送的新版本微信工具包');
        signal.throwIfAborted();if(!authorized())throw new Error('微信授权已变更');
      }
      if(method==='contacts'||method==='history'||method==='conversations'||method==='moments'||method==='moments_interactions'||method==='moments_publish'||method==='moment_detail'){
        const runtime=await this.run({method:'discover'},signal,authorized);
        if(method==='moment_detail'&&runtime.momentsDetailProtocolVersion!==1)throw new Error('请先安装支持朋友圈详情读取的新版本微信工具包');
        if(method==='moments_interactions'&&runtime.momentsInteractionsProtocolVersion!==1)throw new Error('请先安装支持朋友圈互动通知读取的新版本微信工具包');
        if(method==='moments_publish'&&runtime.momentsPublishProtocolVersion!==1)throw new Error('请先安装支持朋友圈发布的微信工具包 0.1.4');
        if(method==='moments'&&runtime.momentsProtocolVersion!==1)throw new Error('请先安装支持朋友圈读取的微信工具包 0.1.3');
        if(method==='conversations'&&runtime.conversationsProtocolVersion!==1)throw new Error('请先安装支持最近会话的微信工具包 0.1.2');
        if(runtime.readProtocolVersion!==2)throw new Error('请先安装微信工具包 0.1.1：当前工具包不支持主动读取');
        signal.throwIfAborted();if(!authorized())throw new Error('微信授权已变更');
      }
      return await this.run({method,params:args,binding:this.binding,experimental:true},signal,authorized);
    }
    finally{this.busy=false;}
  }
  private async run(request:any,signal:AbortSignal,authorized=()=>true):Promise<any>{
    signal.throwIfAborted();
    const python=(this.options.python??join(process.env.LOCALAPPDATA??'','CShell','tools','wechat-bridge','venv','Scripts','python.exe'));
    const cancelFile=join(this.directory,'wechat-cancel-'+randomUUID());
    await mkdir(this.directory,{recursive:true});
    return new Promise((resolve,reject)=>{
      const env:NodeJS.ProcessEnv={...process.env,PYTHONIOENCODING:'utf-8',PYTHONDONTWRITEBYTECODE:'1'};delete env.PYTHONPATH;delete env.PYTHONHOME;
      const child=spawn(python,['-B','-m','cshell_wechat.desktop'],{windowsHide:true,stdio:['pipe','pipe','pipe'],env});
      let output=Buffer.alloc(0),settled=false,cancelled=false;
      const cancel=()=>{if(!cancelled){cancelled=true;void writeFile(cancelFile,'cancel').catch(()=>{});}};
      const timer=setInterval(()=>{if(signal.aborted||!authorized())cancel();},100);
      const deadline=setTimeout(cancel,75000);
      // Do not kill an injected process mid-callback. Retain the busy operation until cleanup/exit.
      const finish=(error?:Error,result?:any)=>{if(settled)return;settled=true;clearInterval(timer);clearTimeout(deadline);void unlink(cancelFile).catch(()=>{});error?reject(error):resolve(result);};
      child.on('error',()=>finish(new Error('微信工具包不可用，请安装最新版离线工具包')));
      child.stdout.on('data',chunk=>{if(output.length+chunk.length>2_000_000){cancel();return;}output=Buffer.concat([output,chunk]);});
      child.stderr.on('data',()=>{});child.stdin.on('error',()=>{});
      child.on('close',()=>{try{const data=JSON.parse(output.toString('utf8'));if(!data.ok)throw new Error(data.error?.code??'WECHAT_FAILED');finish(undefined,data.result);}catch(error){finish(new Error(`微信操作失败或结果未知：${String(error)}。不要自动重试发送。`));}});
      child.stdin.end(JSON.stringify({...request,cancelFile}));
    });
  }
}
