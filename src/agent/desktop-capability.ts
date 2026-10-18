import {readFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {z} from 'zod';
import type {ClientVault} from '../core/client/identity';
import {createBundledCapabilityEntry,capabilityDigest,type CapabilityCatalogEntry} from './capability-catalog';
import type {TrustedCapabilityAdapter} from './capability-runtime';
import type {AgentCapabilityManifest} from '../shared/agent-capability-packages';
import {desktopConfigSchema,desktopQualitySchema} from '../shared/agent-desktop';
import {DesktopService} from './desktop-service';

/** Native bytes are bundled as an optional verified capability, never executed
 * just because the runtime starts or the package is installed. */
export async function createDesktopCapability(options:{identity:string;nativeExecutable:string;vault:Pick<ClientVault,'read'|'write'>;authorize:(owner:string)=>boolean}){
 let registered=false,grants:readonly string[]=[],installedExecutable=options.nativeExecutable;
 let saved=(await options.vault.read('desktop-config',desktopConfigSchema))??desktopConfigSchema.parse({});
 const service=new DesktopService({identity:options.identity,nativeExecutable:()=>installedExecutable,authorize:(owner,permission)=>registered&&grants.includes(`desktop.${permission}`)&&options.authorize(owner),persist:async config=>{saved=config;await options.vault.write('desktop-config',config);}});
 const safeStatus=(owner:string)=>{const status=service.status(owner);if(owner==='local')return status;const {config,...safe}=status;void config;return safe;};
 const bytes=process.platform==='win32'&&process.arch==='x64'?await readFile(options.nativeExecutable).catch(()=>undefined):undefined;
 const extras:{entry:CapabilityCatalogEntry;adapter:TrustedCapabilityAdapter}[]=[];
 if(bytes){
  const manifest:AgentCapabilityManifest={protocol:1,id:'cagent.desktop',name:'自研远程桌面',version:'0.1.1',license:'MIT',description:'Windows 原生桌面采集、H.264 视频及独立观看/控制授权。安装后仍需配置监听和调用方权限；公网与跨平台尚待验收。',source:{repository:'https://github.com/Yeqi99/CShell',releaseTag:'capability-desktop-0.1.1',assetUrl:'https://github.com/Yeqi99/CShell/releases/download/capability-desktop-0.1.1/desktop.cagent-package.json'},compatibility:{platforms:['win32'],architectures:['x64'],agentVersion:{min:'0.6.9',maxExclusive:'1.0.0'}},adapterId:'cagent.desktop',files:[],permissions:['desktop.view','desktop.control'],tools:[{id:'desktop_status',description:'Read desktop service readiness and the caller viewing/control permission. Does not start or connect.',inputSchema:{type:'object',properties:{},additionalProperties:false},outputSchema:{type:'object',properties:{},additionalProperties:true},permissions:['desktop.view'],sideEffect:false},{id:'desktop_close',description:'Close a desktop session owned by this caller; releases its input state.',inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false},outputSchema:{type:'object',properties:{},additionalProperties:true},permissions:['desktop.view'],sideEffect:true}],events:[]};
  const adapter:TrustedCapabilityAdapter={
   inspect:async root=>{const actual=await readFile(join(root,'cagent-desktop.exe')).catch(()=>undefined);const installed=!!actual&&capabilityDigest(actual)===capabilityDigest(bytes);return {installed,configured:installed,systemVersion:'0.1.1'};},
   register:async(root,permissions)=>{installedExecutable=join(root,'cagent-desktop.exe');grants=[...permissions];registered=true;try{await service.configure(saved);}catch(error){registered=false;grants=[];throw error;}},
   invoke:async(tool,args,owner,signal)=>{signal.throwIfAborted();if(tool==='desktop_status')return safeStatus(owner);if(tool==='desktop_close'){await service.close(owner,z.object({id:z.string()}).strict().parse(args).id);return {closed:true};}throw new Error('Unsupported desktop capability tool');},
   quiesce:async()=>{registered=false;grants=[];await service.shutdown();},stop:()=>service.shutdown(),unregister:async()=>{registered=false;grants=[];await service.shutdown();},
  };
  const files:Record<string,Uint8Array>={'cagent-desktop.exe':bytes,'NOTICE.txt':Buffer.from('MIT\nOptional native desktop capability. System codecs are provided by Windows.\n')};
  for(const name of ['LICENSE.desktop-json.txt','LICENSE.desktop-toolchain.txt']){const notice=await readFile(join(dirname(options.nativeExecutable),name)).catch(()=>undefined);if(notice)files[name]=notice;}
  extras.push({entry:createBundledCapabilityEntry(manifest,files),adapter});
 }
 const dispatch=async(method:string,params:unknown,owner:string,local:boolean)=>{
  switch(method){
   case 'desktop.status':return {...safeStatus(owner),nativeAvailable:!!bytes,packageReady:registered};
   case 'desktop.configure':{
    if(!local||owner!=='local')throw new Error('Desktop configuration requires local administration');
    const config=desktopConfigSchema.parse(params);if(config.enabled&&(!registered||!grants.includes('desktop.view')))throw new Error('Install and authorize the desktop capability first');
    return service.configure(config);
   }
   case 'desktop.open':{if(!registered)throw new Error('Desktop package is not ready');const request=z.object({control:z.boolean().default(false),transport:z.enum(['direct','management']).optional(),quality:desktopQualitySchema}).strict().parse(params);return service.open(owner,request);}
   case 'desktop.close':await service.close(owner,z.object({id:z.string().regex(/^[0-9a-f]{32}$/)}).strict().parse(params).id);return {closed:true};
   default:throw new Error('Unsupported desktop method');
  }
 };
 return {service,extraPackages:extras,dispatch,shutdown:()=>service.shutdown()};
}


