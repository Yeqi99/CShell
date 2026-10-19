import {readFile,access} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {join,dirname} from 'node:path';
import {z} from 'zod';
import type {ClientVault} from '../core/client/identity';
import {createBundledCapabilityEntry,capabilityDigest,type CapabilityCatalogEntry} from './capability-catalog';
import type {TrustedCapabilityAdapter} from './capability-runtime';
import type {AgentCapabilityManifest} from '../shared/agent-capability-packages';
import {desktopConfigSchema,desktopQualitySchema} from '../shared/agent-desktop';
import {DesktopService} from './desktop-service';
import {VirtualDisplayBackend,virtualDisplayHost,prepareVirtualDisplayPackage,virtualDisplayInstallInput} from './virtual-display';
import {systemDesktopStatus} from './system-desktop';

/** Native bytes are bundled as an optional verified capability, never executed
 * just because the runtime starts or the package is installed. */
export async function createDesktopCapability(options:{identity:string;nativeExecutable:string;vault:Pick<ClientVault,'read'|'write'>;authorize:(owner:string)=>boolean}){
 const virtualHelper=join(dirname(options.nativeExecutable),'CAgentVirtualDisplay.exe');
 const virtualPlans=new Map<string,{owner:string;expires:number;input:z.infer<typeof virtualDisplayInstallInput>}>();
 let virtualBusy=false;
 const virtualBackend=async(directory='')=>VirtualDisplayBackend.native(await virtualDisplayHost(),directory,virtualHelper);
 let registered=false,grants:readonly string[]=[],installedExecutable=options.nativeExecutable;
 let selectedSystemProxy:string|undefined;
 let systemStatusCache:{at:number;value:Awaited<ReturnType<typeof systemDesktopStatus>>}|undefined;
 let systemStatusPending:Promise<Awaited<ReturnType<typeof systemDesktopStatus>>>|undefined;
 const refreshSystemDesktop=async(force=false)=>{
  if(!force&&systemStatusCache&&Date.now()-systemStatusCache.at<5000)return systemStatusCache.value;
  if(!systemStatusPending)systemStatusPending=systemDesktopStatus(dirname(options.nativeExecutable)).then(value=>{
   selectedSystemProxy=value.ready&&'proxyPath' in value&&value.proxyPath?value.proxyPath:undefined;
   systemStatusCache={at:Date.now(),value};return value;
  }).finally(()=>{systemStatusPending=undefined;});
  return systemStatusPending;
 };
 let saved=(await options.vault.read('desktop-config',desktopConfigSchema))??desktopConfigSchema.parse({enabled:true,directListener:false,authenticatedPeers:true,local:{view:true,control:true}});
 const service=new DesktopService({identity:options.identity,nativeExecutable:()=>selectedSystemProxy??installedExecutable,authorize:(owner,permission)=>registered&&grants.includes(`desktop.${permission}`)&&options.authorize(owner),persist:async config=>{saved=config;await options.vault.write('desktop-config',config);}});
 const safeStatus=(owner:string)=>{const status=service.status(owner);if(owner==='local')return status;const {config,...safe}=status;void config;return safe;};
 const bytes=process.platform==='win32'&&process.arch==='x64'?await readFile(options.nativeExecutable).catch(()=>undefined):undefined;
 const extras:{entry:CapabilityCatalogEntry;adapter:TrustedCapabilityAdapter}[]=[];
 if(bytes){
  const manifest:AgentCapabilityManifest={protocol:1,id:'cagent.desktop',name:'自研远程桌面',version:'0.1.2',license:'MIT',description:'Windows 原生桌面采集、H.264 视频及独立观看/控制授权。安装后仍需配置监听和调用方权限；公网与跨平台尚待验收。',source:{repository:'https://github.com/Yeqi99/CShell',releaseTag:'capability-desktop-0.1.2',assetUrl:'https://github.com/Yeqi99/CShell/releases/download/capability-desktop-0.1.2/desktop.cagent-package.json'},compatibility:{platforms:['win32'],architectures:['x64'],agentVersion:{min:'0.6.34',maxExclusive:'1.0.0'}},adapterId:'cagent.desktop',files:[],permissions:['desktop.view','desktop.control'],tools:[{id:'desktop_status',description:'Read desktop service readiness and the caller viewing/control permission. Does not start or connect.',inputSchema:{type:'object',properties:{},additionalProperties:false},outputSchema:{type:'object',properties:{},additionalProperties:true},permissions:['desktop.view'],sideEffect:false},{id:'desktop_close',description:'Close a desktop session owned by this caller; releases its input state.',inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false},outputSchema:{type:'object',properties:{},additionalProperties:true},permissions:['desktop.view'],sideEffect:true}],events:[]};
  const adapter:TrustedCapabilityAdapter={
   inspect:async root=>{const actual=await readFile(join(root,'cagent-desktop.exe')).catch(()=>undefined);const installed=!!actual&&capabilityDigest(actual)===capabilityDigest(bytes);return {installed,configured:installed,systemVersion:'0.1.2'};},
   register:async(root,permissions)=>{installedExecutable=join(root,'cagent-desktop.exe');grants=[...permissions];registered=true;try{await service.configure(saved);}catch(error){registered=false;grants=[];throw error;}},
   invoke:async(tool,args,owner,signal)=>{signal.throwIfAborted();if(tool==='desktop_status')return safeStatus(owner);if(tool==='desktop_close'){await service.close(owner,z.object({id:z.string()}).strict().parse(args).id);return {closed:true};}throw new Error('Unsupported desktop capability tool');},
   quiesce:async()=>{registered=false;grants=[];await service.shutdown();},stop:()=>service.shutdown(),unregister:async()=>{registered=false;grants=[];await service.shutdown();},
  };
  const files:Record<string,Uint8Array>={'cagent-desktop.exe':bytes,'NOTICE.txt':Buffer.from('MIT\nOptional native desktop capability. System codecs are provided by Windows.\n')};
  for(const name of ['LICENSE.desktop-json.txt','LICENSE.desktop-toolchain.txt']){const notice=await readFile(join(dirname(options.nativeExecutable),name)).catch(()=>undefined);if(notice)files[name]=notice;}
  extras.push({entry:createBundledCapabilityEntry(manifest,files),adapter});
 }
 const dispatch=async(method:string,params:unknown,owner:string,local:boolean)=>{
  if(method.startsWith('desktop.virtual-display.')){
   if(!options.authorize(owner)||(!local&&owner==='local'))throw new Error('虚拟显示需要此机器的管理权限');
   if(!registered)throw new Error('请先安装并授权远程桌面应用');
   if(method==='desktop.virtual-display.plan'){
    const input=virtualDisplayInstallInput.omit({confirm:true}).parse(params??{});
    const backend=await virtualBackend();const plan=backend.plan();
    const helperAvailable=await access(virtualHelper).then(()=>true,()=>false);
    for(const [id,item] of virtualPlans)if(item.expires<Date.now())virtualPlans.delete(id);
    if(virtualPlans.size>=16)throw new Error('虚拟显示安装计划过多，请等待过期');
    const id=randomUUID(),expires=Date.now()+10*60_000;
    virtualPlans.set(id,{owner,expires,input:{...input,confirm:true}});
    return {...plan,id,expires,helperAvailable,width:input.width,height:input.height,experimentalServer:input.experimentalServer,executable:helperAvailable&&plan.compatible&&(!plan.experimental||input.experimentalServer)};
   }
   if(method==='desktop.virtual-display.status'){
    const input=z.object({id:z.string().regex(/^[a-f0-9]{32}$/).optional()}).strict().parse(params??{});
    const backend=await virtualBackend();
    if(input.id)return backend.status(input.id);
    return {plan:backend.plan(),probe:await backend.probe(),tasks:await backend.list().catch(error=>({error:String(error)})),busy:virtualBusy};
   }
   if(virtualBusy)throw new Error('虚拟显示操作正在执行');
   virtualBusy=true;
   try{
    if(method==='desktop.virtual-display.install'){
     const input=z.object({planId:z.string().uuid(),confirm:z.literal(true)}).strict().parse(params);
     const plan=virtualPlans.get(input.planId);
     if(!plan||plan.owner!==owner||plan.expires<Date.now())throw new Error('安装计划无效或已过期，请重新检查');
     virtualPlans.delete(input.planId);
     const readiness=(await virtualBackend()).plan();
     if(!readiness.compatible||(readiness.experimental&&!plan.input.experimentalServer))throw new Error('目标平台不支持此安装计划');
     await access(virtualHelper);
     const downloaded=await prepareVirtualDisplayPackage();
     try{if(!options.authorize(owner))throw new Error('管理授权已撤销');return await (await virtualBackend(downloaded.directory)).install(plan.input);}finally{await downloaded.cleanup();}
    }
    const input=z.object({id:z.string().regex(/^[a-f0-9]{32}$/),confirm:z.literal(true)}).strict().parse(params);
    const backend=await virtualBackend();
    if(!options.authorize(owner))throw new Error('管理授权已撤销');
    if(method==='desktop.virtual-display.remove')return await backend.remove(input.id,true);
    if(method==='desktop.virtual-display.recover')return await backend.recover(input.id,true);
    throw new Error('Unsupported virtual display method');
   }finally{virtualBusy=false;}
  }
  switch(method){
   case 'desktop.status':return {...safeStatus(owner),...(local?{config:service.status('local').config}:{}),inputFeatures:['unicode-text'],nativeAvailable:!!bytes,packageReady:registered,systemDesktop:await refreshSystemDesktop()};
   case 'desktop.configure':{
    if(!local)throw new Error('Desktop configuration requires local administration');
    const config=desktopConfigSchema.parse(params);if(config.enabled&&(!registered||!grants.includes('desktop.view')))throw new Error('Install and authorize the desktop capability first');
    return service.configure(config);
   }
   case 'desktop.open':{if(!registered)throw new Error('Desktop package is not ready');const request=z.object({control:z.boolean().default(false),mediaTransport:z.enum(['udp','tcp']).optional(),transport:z.enum(['direct','management']).optional(),quality:desktopQualitySchema}).strict().parse(params);await refreshSystemDesktop(true);return service.open(owner,request);}
   case 'desktop.close':await service.close(owner,z.object({id:z.string().regex(/^[0-9a-f]{32}$/)}).strict().parse(params).id);return {closed:true};
   default:throw new Error('Unsupported desktop method');
  }
 };
 return {service,extraPackages:extras,dispatch,shutdown:()=>service.shutdown()};
}


