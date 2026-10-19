import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { z } from 'zod';
import { WechatService } from '../core/wechat';
import { createBundledCapabilityEntry, capabilityDigest } from './capability-catalog';
import type { AgentCapabilityManifest } from '../shared/agent-capability-packages';
import type { TrustedCapabilityAdapter } from './capability-runtime';

/** The executable runtime is shipped beside CAgent, never borrowed from CShell. */
export async function createWechatCapability(options:{directory:string;runtime:string;authorize:(owner:string)=>boolean}) {
  let registered=false;
  const service=new WechatService(join(options.directory,'wechat'),{plugins:()=>[]},{python:join(options.runtime,'python.exe'),enabled:()=>true});
  await service.load();
  const verify=async()=>{
    const files=z.record(z.string(),z.string().regex(/^[a-f0-9]{64}$/)).parse(JSON.parse(await readFile(join(options.runtime,'files.json'),'utf8')));
    if(!files['python.exe']||!files['cshell_wechat/desktop.py'])throw new Error('微信运行包不完整');
    for(const [file,digest] of Object.entries(files)){
      const path=resolve(options.runtime,file),within=relative(options.runtime,path);
      if(within.startsWith('..')||isAbsolute(within)||capabilityDigest(await readFile(path))!==digest)throw new Error('微信运行包核验失败');
    }
  };
  const ownershipFile=join(options.directory,'wechat','owners.json');
  let owners:Record<string,string>={};
  try{owners=z.record(z.string(),z.string()).parse(JSON.parse(await readFile(ownershipFile,'utf8')));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const tools=service.tools();
  const manifest:AgentCapabilityManifest={protocol:1,id:'cagent.wechat',name:'微信掌控',version:'0.1.4',license:'MIT',
    description:'控制此 Windows 机器当前登录的微信：通讯录、最近会话、历史、收发、订阅、备注及已实现的朋友圈能力。需绑定受支持的微信版本。',
    source:{repository:'https://github.com/Yeqi99/CShell',releaseTag:'v0.6.32',assetUrl:'https://github.com/Yeqi99/CShell/releases/download/v0.6.32/CAgent-Setup-0.6.32-win-x64.exe'},
    compatibility:{platforms:['win32'],architectures:['x64'],agentVersion:{min:'0.6.32',maxExclusive:'1.0.0'}},
    adapterId:'cagent.wechat',files:[],permissions:['wechat.read','wechat.send','wechat.contacts.manage'],
    tools:tools.map(tool=>({id:tool.name,description:'On the selected CAgent machine ONLY. '+tool.description.replace('independent of the conversation remote machine','bound to this CAgent machine'),inputSchema:z.toJSONSchema(tool.input,{io:'input'}) as AgentCapabilityManifest['tools'][number]['inputSchema'],outputSchema:{type:'object',properties:{},additionalProperties:true},permissions:[tool.capability],sideEffect:tool.needsReview({})})),events:[]};
  const adapter:TrustedCapabilityAdapter={
    inspect:async()=>{await verify();return {installed:true,configured:await service.ready()};},
    register:async()=>{registered=true;},
    quiesce:async()=>{registered=false;await service.subscriptions.stopAll();},
    stop:()=>service.subscriptions.stopAll(),
    invoke:async(id,args,owner,signal)=>{
      if(!registered||!options.authorize(owner))throw new Error('微信能力已停用或调用方已撤权');
      const tool=tools.find(t=>t.name===id);if(!tool)throw new Error('未知微信工具');
      const parsed=tool.input.parse(args) as Record<string,any>;
      if((id==='wechat_events'||id==='wechat_unsubscribe')&&owners[parsed.subscriptionId]!==owner)throw new Error('订阅不属于此调用方');
      if(parsed.idempotencyKey)parsed.idempotencyKey=capabilityDigest(owner+'\0'+parsed.idempotencyKey);
      let result:string;
      try{result=id==='wechat_subscribe'
        ?await service.subscribeAuthorized(parsed,signal,()=>registered&&options.authorize(owner))
        :await tool.invoke(parsed,signal);}
      catch(error){throw new Error(String(error instanceof Error?error.message:error).replace(/\[前往授权\]\([^)]*\)/g,"请打开此机器的应用市场 → 微信掌控"));}
      const value=JSON.parse(result);
      if(id==='wechat_subscribe'){
        if(typeof value.id!=='string'){await service.subscriptions.stopAll();throw new Error('订阅缺少身份');}
        owners[value.id]=owner;
        try{await mkdir(join(options.directory,'wechat'),{recursive:true});await writeFile(ownershipFile+'.tmp',JSON.stringify(owners));await rename(ownershipFile+'.tmp',ownershipFile);}
        catch(error){await service.subscriptions.stop(value.id,false);throw error;}
      }
      if(id==='wechat_subscriptions')return value.filter((item:any)=>owners[item.id]===owner);
      if(id==='wechat_status'&&Array.isArray(value.subscriptions))value.subscriptions=value.subscriptions.filter((item:any)=>owners[item.id]===owner);
      return value;
    },
  };
  return {service,verify,extraPackages:process.platform==='win32'&&process.arch==='x64'?[{entry:createBundledCapabilityEntry(manifest,{'NOTICE.txt':Buffer.from('MIT\nVersion-pinned WeChat adapter. Runtime dependencies retain their respective licenses.\n')}),adapter}]:[],shutdown:()=>service.subscriptions.stopAll()};
}
