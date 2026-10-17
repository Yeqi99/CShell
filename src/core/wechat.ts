import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile,writeFile,mkdir,unlink,rename } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { Store } from './store';
import type { ConnectionTool } from './connections/contracts';
import { pluginEnabled } from '../shared/plugins';
import { emptyWechatConfig,wechatConfigSchema,wechatTargetSchema } from '../shared/wechat';

export class WechatService {
  private config=emptyWechatConfig();
  private binding: unknown=null;
  private busy=false;
  private revision=0;
  constructor(private directory:string,private store:Store){}
  private get file(){return join(this.directory,'wechat.json');}
  async load(){try{const data=JSON.parse(await readFile(this.file,'utf8'));this.config=wechatConfigSchema.parse(data.config);this.binding=data.binding;}catch{this.config=emptyWechatConfig();}}
  private requirePlugin(){if(process.platform!=='win32')throw new Error('微信控制目前仅支持 Windows');if(!pluginEnabled(this.store.plugins(),'wechat'))throw new Error('请先安装并启用微信扩展');}
  async status(){this.requirePlugin();try{const result=await this.run({method:'discover'},new AbortController().signal);return {config:this.config,processes:result.processes};}catch(error){return {config:this.config,processes:[],error:String(error)};}}
  async save(input:unknown){
    this.requirePlugin();if(this.busy)throw new Error('请先停止正在进行的微信操作');
    const config=wechatConfigSchema.parse(input);
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
    if(!pluginEnabled(this.store.plugins(),'wechat')||process.platform!=='win32')return [];
    const tool=(name:string,method:string,capability:string,input:z.ZodType,description:string,review=false):ConnectionTool=>({
      name,capability,input,description,needsReview:()=>review,
      invoke:async(args,signal)=>JSON.stringify(await this.invoke(method,args,signal)),
    });
    return [
      tool('wechat_status','status','wechat.read',z.object({}).strict(),'Inspect WeChat on THIS Windows computer, independent of the conversation remote machine. Shows exact supported processes and local grant settings.'),
      tool('wechat_get_remark','remark_read','wechat.read',z.object({target:z.string().regex(/^wxid_[A-Za-z0-9_]{3,64}$/)}).strict(),'Read the current local remark for one explicitly remark-authorized individual. Read before requesting a change. Does not enumerate contacts or confirm server persistence.'),
      tool('wechat_set_remark','remark_set','wechat.contacts.manage',z.object({target:z.string().regex(/^wxid_[A-Za-z0-9_]{3,64}$/),remark:z.string().max(64).refine(s=>Buffer.byteLength(s,'utf8')<=128&&!/[\x00-\x1f\x7f]/.test(s)),expectedRemark:z.string().max(64).refine(s=>Buffer.byteLength(s,'utf8')<=128&&!/[\x00-\x1f\x7f]/.test(s)),idempotencyKey:z.string().regex(/^[A-Za-z0-9_-]{8,128}$/)}).strict(),'Set an explicitly authorized individual contact remark on THIS computer. First read with wechat_get_remark and provide exact expectedRemark; conflict means no change submitted. Empty remark clears it. Native return is not server confirmation; read back and report uncertainty. Not atomic against other devices. Never retry unknown outcomes with a new key. Experimental native adapter may crash WeChat.',true),
      tool('wechat_contacts','contacts','wechat.read',z.object({}).strict(),'Read bounded loaded contact candidates from the locally bound WeChat. Incomplete; never infer a unique recipient from a nickname. Native experimental adapter can crash WeChat.'),
      tool('wechat_send_text','send','wechat.send',z.object({recipient:wechatTargetSchema,text:z.string().min(1).max(4096),idempotencyKey:z.string().regex(/^[A-Za-z0-9_-]{8,128}$/)}).strict(),'Send one real text through locally bound WeChat to an allowed internal ID or filehelper. A saved * send grant allows all valid recipients; sendBlocked always denies matching IDs. The recipient argument must be one exact ID, never *. Never retry unknown outcomes with a new key. native_returned is not delivery confirmation. Experimental; may crash WeChat.',true),
      tool('wechat_receive','receive','wechat.read',z.object({targets:z.array(z.string().max(80)).min(1).max(20),seconds:z.number().int().min(1).max(30).default(15)}).strict(),'Listen for new messages from explicitly allowed IDs on THIS computer for up to 30 seconds; no history replay. Experimental; may crash WeChat.'),
      tool('wechat_history','history','wechat.read',z.object({target:z.string().max(80),limit:z.number().int().min(1).max(30).default(20),direction:z.enum(['latest','before','after']).default('latest'),cursor:z.string().max(2048).optional()}).strict(),'Read real local WeChat message_0.db history for an explicitly allowed target. Use olderCursor with before, newerCursor with after; save the cursor after processing and deduplicate by deduplicationKey after restart. Rebind the process after restart. Other database shards and remote/deleted history are NOT covered; inspect gap, complete and contentStatus. No automatic sending or background sync. Experimental native read may require conversation activity and can crash WeChat.'),
    ];
  }
  private async invoke(method:string,args:any,signal:AbortSignal){
    this.requirePlugin();if(method==='status')return this.status();
    if(this.busy)throw new Error('微信已有操作在运行');
    if(!this.config.enabled||!this.config.experimental||!this.binding)throw new Error('请在微信扩展中绑定进程并启用实验控制');
    if(method==='contacts'&&!this.config.readContacts)throw new Error('未授权读取联系人');
    if(method==='send'){
      wechatTargetSchema.parse(args.recipient);
      if(this.config.sendBlocked.includes(args.recipient))throw new Error('收件人在微信发送黑名单中');
      if(!this.config.send.includes('*')&&!this.config.send.includes(args.recipient))throw new Error('收件人不在微信发送授权列表');
    }
    if(method==='receive'&&args.targets.some((id:string)=>!this.config.receive.includes(id)))throw new Error('接收目标不在授权列表');
    if(method==='history'&&!this.config.history.includes(args.target))throw new Error('历史读取目标不在授权列表');
    if(method.startsWith('remark_')&&!this.config.remarks.includes(args.target))throw new Error('联系人不在微信备注授权列表');
    const revision=this.revision;this.busy=true;
    try{return await this.run({method,params:args,binding:this.binding,experimental:true},signal,()=>revision===this.revision&&pluginEnabled(this.store.plugins(),'wechat')&&this.config.enabled);}
    finally{this.busy=false;}
  }
  private async run(request:any,signal:AbortSignal,authorized=()=>true):Promise<any>{
    signal.throwIfAborted();
    const python=join(process.env.LOCALAPPDATA??'','CShell','tools','wechat-bridge','venv','Scripts','python.exe');
    const cancelFile=join(this.directory,'wechat-cancel-'+randomUUID());
    await mkdir(this.directory,{recursive:true});
    return new Promise((resolve,reject)=>{
      const env:NodeJS.ProcessEnv={...process.env,PYTHONIOENCODING:'utf-8'};delete env.PYTHONPATH;delete env.PYTHONHOME;
      const child=spawn(python,['-m','cshell_wechat.desktop'],{windowsHide:true,stdio:['pipe','pipe','pipe'],env});
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
