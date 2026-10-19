import {randomUUID} from 'node:crypto';
import {mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {z} from 'zod';
import type {AiProviderExtension} from '../../core/ai-extension';
import {family,encodeRequest,normalizeResponse} from './protocol';
const configSchema=z.object({key:z.string().max(16000).default(''),workspace:z.string().regex(/^(?:wrk_|org_)[A-Za-z0-9_-]{1,100}$/).optional()});
const modelSchema=z.object({id:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/)});
const tierSchema=z.enum(['go','zen']);
export function quotaWindows(raw:any){
  return [['rollingUsage','5 小时'],['weeklyUsage','每周'],['monthlyUsage','每月']].flatMap(([key,label])=>{
    const v=raw?.[key];if(!v||typeof v.usagePercent!=='number'||!Number.isFinite(v.usagePercent))return [];
    return [{label,usedPercent:v.usagePercent,resetAt:typeof v.resetAt==='string'?v.resetAt:typeof v.resetInSec==='number'&&Number.isFinite(v.resetInSec)&&v.resetInSec>=0?new Date(Date.now()+v.resetInSec*1000).toISOString():undefined}];
  });
}
export class OpenCodeExtension implements AiProviderExtension {
  readonly id='cshell.opencode';
  private config:z.infer<typeof configSchema>={key:''};
  private cache=new Map<string,{at:number;models:{id:string;available:boolean}[]}>();
  private saving=Promise.resolve();
  private loadError='';
  constructor(private host:{directory:string;enabled:()=>boolean;encrypt:(s:string)=>Promise<string>;decrypt:(s:string)=>Promise<string>;saveProvider:(p:any)=>Promise<void>;open:(url:string)=>Promise<void>},private network:typeof fetch=fetch){}
  private check(){if(!this.host.enabled())throw Error('请先在插件市场启用 OpenCode 扩展');if(this.loadError)throw Error(this.loadError);}
  async load(){try{this.config=configSchema.parse(JSON.parse(await this.host.decrypt(await readFile(join(this.host.directory,'opencode.enc'),'utf8'))));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')this.loadError='OpenCode 扩展配置读取失败，请检查本机凭据存储';}}
  private url(tier:'go'|'zen',suffix:string){return `https://opencode.ai/inference/${tier==='go'?'go/':''}${suffix}`;}
  private async json(url:string,key=false){
    this.check();const r=await this.network(url,{redirect:'error',signal:AbortSignal.timeout(20000),headers:{Accept:'application/json',...(key&&this.config.key?{Authorization:`Bearer ${this.config.key}`}:{})}});
    if(!r.ok){await r.body?.cancel();throw Error(`OpenCode HTTP ${r.status}${r.status===401?'：请检查 API Key':r.status===403?'：此 Key 或套餐没有访问权限':''}`);}
    const reader=r.body?.getReader();if(!reader)throw Error('OpenCode 返回空响应');let size=0;const chunks:Uint8Array[]=[];
    try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2_000_000)throw Error('OpenCode 响应过大');chunks.push(value);}}finally{await reader.cancel();}
    this.check();return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  async models(tier:'go'|'zen',refresh=false){
    this.check();const cached=this.cache.get(tier);if(!refresh&&cached&&Date.now()-cached.at<300000)return cached.models;
    const result=await this.json(this.url(tier,'v1/models'));const data=z.object({data:z.array(modelSchema).max(2000)}).parse(result);
    const models=[...new Set(data.data.map(m=>m.id))].sort().map(id=>({id,available:!!family(id)}));this.cache.set(tier,{at:Date.now(),models});return models;
  }
  async call(action:string,input:unknown):Promise<any>{
    this.check();
    if(action==='status')return {hasKey:!!this.config.key,workspace:this.config.workspace??'',usageUrl:this.consoleUrl('go')};
    if(action==='save'){
      const p=z.object({key:z.string().max(16000).optional(),workspace:z.string().max(2000).default('')}).strict().parse(input);
      const workspace=p.workspace.startsWith('https://')?new URL(p.workspace).pathname.split('/').find(s=>/^(wrk_|org_)/.test(s)):p.workspace;
      const task=this.saving.catch(()=>{}).then(async()=>{this.check();const next=configSchema.parse({key:p.key??this.config.key,...(workspace?{workspace}:{})});const path=join(this.host.directory,'opencode.enc');await mkdir(dirname(path),{recursive:true});const temp=path+'.'+randomUUID()+'.tmp';await writeFile(temp,await this.host.encrypt(JSON.stringify(next)));this.check();await rename(temp,path);this.config=next;this.cache.clear();});this.saving=task;await task;return this.call('status',{});
    }
    if(action==='models'){const p=z.object({tier:tierSchema,refresh:z.boolean().default(false)}).parse(input);return this.models(p.tier,p.refresh);}
    if(action==='choices'){const ref=z.string().max(300).parse((input as any)?.reference);const tier=tierSchema.parse(ref.split('/')[0]);return (await this.models(tier)).map(m=>({ref:`${tier}/${m.id}`,model:m.id,available:m.available}));}
    if(action==='usage'){
      if(!this.config.key)throw Error('请先保存 API Key');
      const value=await this.json(this.url('go','v1/usage'),true);const windows=quotaWindows(value);
      return {windows,available:windows.length>0,useBalance:typeof value.useBalance==='boolean'?value.useBalance:undefined,checkedAt:Date.now(),message:windows.length?'官方 Go 套餐使用量；不是现金余额':'服务返回了未识别的额度格式，请在控制台查看',url:this.consoleUrl('go')};
    }
    if(action==='open'){const page=z.enum(['keys','go']).parse((input as any)?.page);await this.host.open(this.consoleUrl(page));return;}
    if(action==='add'){
      const p=z.object({tier:tierSchema,model:modelSchema.shape.id,name:z.string().trim().min(1).max(80),id:z.string().uuid().optional()}).strict().parse(input);
      await this.resolve(`${p.tier}/${p.model}`,'configuration');
      const id=p.id??randomUUID();await this.host.saveProvider({id,name:p.name,url:'https://model-extension.invalid',model:p.model,extension:{id:this.id,model:`${p.tier}/${p.model}`}});return {id};
    }
    throw Error('不支持的模型扩展操作');
  }
  private consoleUrl(page:'keys'|'go'){return `https://opencode.ai/console/${this.config.workspace?this.config.workspace+'/':''}${this.config.workspace?page:''}`;}
  async resolve(reference:string,session:string){
    this.check();if(!this.config.key)throw Error('请先在 OpenCode 扩展中配置 API Key');
    const [tierValue,model,...extra]=reference.split('/');const tier=tierSchema.parse(tierValue);if(extra.length)throw Error('模型标识无效');
    const listed=(await this.models(tier)).find(m=>m.id===model);if(!listed?.available)throw Error('该模型不在当前目录中，或尚未适配其协议；请刷新 OpenCode 模型列表');
    const kind=family(model)!;
    const transport:typeof fetch=async(_url,init)=>{
      this.check();const key=this.config.key;if(!key)throw Error('OpenCode Key 已移除');
      const b=JSON.parse(String(init?.body));if(b.model!==model)throw Error('模型配置已变化');
      const suffix=kind==='chat'?'openai/v1/chat/completions':kind==='responses'?'openai/v1/responses':kind==='anthropic'?'anthropic/v1/messages':`google/v1beta/models/${encodeURIComponent(model)}:${b.stream?'streamGenerateContent?alt=sse':'generateContent'}`;
      const response=await this.network(this.url(tier,suffix),{method:'POST',redirect:'error',signal:init?.signal,headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`,'User-Agent':'CShell-OpenCode-Extension/1.0','x-opencode-session':session,...(kind==='anthropic'?{'anthropic-version':'2023-06-01'}:{})},body:JSON.stringify(encodeRequest(kind,b))});
      this.check();return normalizeResponse(response,kind,!!b.stream);
    };
    return {url:'https://model-extension.invalid',model,key:'',transport};
  }
}
