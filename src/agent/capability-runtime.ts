import { z } from 'zod';
import { join, relative, isAbsolute } from 'node:path';
import { rm } from 'node:fs/promises';
import type { ClientVault } from '../core/client/identity';
import type { AgentApplicationService } from './applications';
import { CapabilityPackages, parseCapabilityManifest } from './capability-packages';
import { capabilityCatalog, capabilityDigest, type CapabilityCatalogEntry } from './capability-catalog';
import { capabilityInstallInput, stageCapabilityBundle } from './capability-installer';
import type { AgentCapabilityManifest, CapabilityPackageRecord } from '../shared/agent-capability-packages';

export interface TrustedCapabilityAdapter {
  inspect(root:string):Promise<{installed:boolean;configured:boolean;systemVersion?:string}>;
  invoke(toolId:string,args:unknown,owner:string,signal:AbortSignal):Promise<unknown>;
  register?(root:string,grants:readonly string[]):Promise<void>;
  quiesce?():Promise<void>;stop?():Promise<void>;unregister?():Promise<void>;
}
export type RuntimeCapabilityTool = AgentCapabilityManifest['tools'][number] & {packageId:string;toolId:string;process?:true;packageDigest?:string};
const idInput=z.object({id:z.string().min(1).max(100)}).strict();
const invokeInput=z.object({packageId:z.string().min(1).max(100),toolId:z.string().min(1).max(100),args:z.unknown()}).strict();
export class CapabilityRuntime {
  private manager:CapabilityPackages;
  private entries:CapabilityCatalogEntry[];
  private adapters=new Map<string,TrustedCapabilityAdapter>();
  private registered=new Map<string,{manifest:AgentCapabilityManifest;grants:readonly string[]}>();
  private active=new Map<string,Set<{controller:AbortController;done:Promise<void>}>>();
  get activity(){return [...this.active.values()].reduce((sum,items)=>sum+items.size,0);}
  private roots=new Map<string,string>();
  private installedManifestDigests=new Map<string,string>();
  private mutation:Promise<unknown>=Promise.resolve();
  private closing=false;
  constructor(private options:{directory:string;vault:Pick<ClientVault,'read'|'write'>;applications:AgentApplicationService;agentVersion:string;extraPackages?:{entry:CapabilityCatalogEntry;adapter:TrustedCapabilityAdapter}[]}){
    this.entries=capabilityCatalog();
    const installationTasks=new Map<string,string>();
    const system:TrustedCapabilityAdapter={
      inspect:async()=>({installed:true,configured:true}),
      invoke:async(toolId,args,owner,signal)=>{
        signal.throwIfAborted();
        switch(toolId){
          case 'system_apps_catalog':return options.applications.list(owner);
          case 'system_apps_plan':return options.applications.plan(args,owner,signal);
          case 'system_apps_status':return options.applications.status(args,owner);
          case 'system_apps_cancel':return options.applications.cancel(args,owner);
          case 'system_apps_install':{
            const id=z.object({id:z.string().uuid()}).passthrough().parse(args).id;
            const result=await options.applications.install(args,owner);
            if(result.state==='running')installationTasks.set(id,owner);return result;
          }
          default:throw new Error('Unknown system application capability');
        }
      },
      stop:async()=>{
        for(const [id,owner] of installationTasks){
          await options.applications.cancelAndWait({id},owner);
          installationTasks.delete(id);
        }
      },
    };
    this.adapters.set('cagent.system-apps',system);
    for(const extra of options.extraPackages??[]){
      if(this.entries.some(entry=>entry.id===extra.entry.id))throw new Error('Duplicate capability catalog ID');
      const raw=extra.entry.source==='bundled'&&extra.entry.bundle?JSON.parse(extra.entry.bundle).manifest:extra.entry.manifestJson;
      if(!raw)throw new Error('Injected adapters require a host-pinned verified manifest');
      const manifest=parseCapabilityManifest(raw,extra.entry.manifestSha256);
      if(extra.entry.source==='github'&&extra.entry.url!==manifest.source.assetUrl)throw new Error('Injected adapter source mismatch');
      if(manifest.id!==extra.entry.id||manifest.version!==extra.entry.version||this.adapters.has(manifest.adapterId))throw new Error('Duplicate or mismatched adapter ID');
      this.entries.push(structuredClone(extra.entry));this.adapters.set(manifest.adapterId,extra.adapter);
    }
    this.manager=new CapabilityPackages({environment:{platform:process.platform,architecture:process.arch,agentVersion:options.agentVersion},
      hasAdapter:id=>this.adapters.has(id),
      inspect:(manifest,root)=>this.adapters.get(manifest.adapterId)!.inspect(root),
      register:async(manifest,root,grants)=>{
        await this.adapters.get(manifest.adapterId)!.register?.(root,grants);
        this.registered.set(manifest.id,{manifest,grants});
      },
      quiesce:async id=>{
        const record=this.registered.get(id);this.registered.delete(id);
        for(const running of this.active.get(id)??[])running.controller.abort(new Error('Capability removed or permissions changed'));
        if(record)await this.adapters.get(record.manifest.adapterId)?.quiesce?.();
      },
      stopTasksAndSubscriptions:async id=>{
        let timer:ReturnType<typeof setTimeout>|undefined;
        try{await Promise.race([Promise.all([...this.active.get(id)??[]].map(item=>item.done)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Capability calls have not stopped')),5000);})]);}finally{clearTimeout(timer);}
        const manifest=this.manifestFor(id);if(manifest)await this.adapters.get(manifest.adapterId)?.stop?.();
      },
      unregister:async id=>{const manifest=this.manifestFor(id);if(manifest)await this.adapters.get(manifest.adapterId)?.unregister?.();},
      load:async()=>{
        const saved=await options.vault.read('capability-packages',z.array(z.custom<CapabilityPackageRecord>(value=>!!value&&typeof value==='object')).max(100))??[];
        for(const record of saved){this.roots.set(record.id,record.root);this.installedManifestDigests.set(record.id,record.manifestSha256);}return saved;
      },
      save:async records=>{await options.vault.write('capability-packages',records);this.roots=new Map(records.map(record=>[record.id,record.root]));this.installedManifestDigests=new Map(records.map(record=>[record.id,record.manifestSha256]));},
    });
  }
  private manifestFor(id:string){const entry=this.entries.find(item=>item.id===id);if(!entry)return undefined;const raw=entry.bundle?JSON.parse(entry.bundle).manifest:entry.manifestJson;return raw?parseCapabilityManifest(raw,entry.manifestSha256):undefined;}
  private mutate<T>(action:()=>Promise<T>):Promise<T>{const operation=this.mutation.then(()=>{if(this.closing)throw new Error('Capability runtime closing');return action();});this.mutation=operation.catch(()=>{});return operation;}
  async load(){await this.manager.init();for(const item of this.manager.list())await this.manager.refresh(item.id);}
  list(){return this.manager.list();}
  catalog(){return this.entries.map(({bundle:_,url:__,manifestSha256:___,bundleSha256:____,bundleBytes:_____,manifestJson:______,maxBundleBytes:_______,...entry})=>{
    const installed=this.manager.list().find(item=>item.id===entry.id);return {...entry,installed:!!installed,status:installed?.status??'not-installed',reason:installed?.reason,grants:installed?.grants??[]};
  });}
  install(input:unknown,signal:AbortSignal=new AbortController().signal){return this.mutate(async()=>{
    const {id}=capabilityInstallInput.parse(input),entry=this.entries.find(item=>item.id===id);if(!entry)throw new Error('Package not in trusted catalog');
    const existing=this.manager.list().find(item=>item.id===id);if(existing?.version===entry.version&&this.installedManifestDigests.get(id)===entry.manifestSha256&&existing.status!=='fault')return this.manager.refresh(id);
    const oldRoot=this.roots.get(id);
    const staged=await stageCapabilityBundle(join(this.options.directory,'capability-packages'),entry,signal);
    let result;
    try{result=await this.manager.stage(staged.manifestJson,staged.root,staged.manifestSha256);}
    catch(error){if(this.roots.get(id)!==staged.root)await this.removeRoot(staged.root);throw error;}
    if(oldRoot&&oldRoot!==staged.root)await this.cleanupRetiredRoot(oldRoot);return result;
  });}
  grant(input:unknown){return this.mutate(async()=>{const {id,permissions}=idInput.extend({permissions:z.array(z.string()).max(64)}).strict().parse(input);return this.manager.setPermissions(id,permissions);});}
  refresh(input:unknown){return this.mutate(()=>this.manager.refresh(idInput.parse(input).id));}
  uninstall(input:unknown){return this.mutate(async()=>{const {id}=capabilityInstallInput.parse(input),root=this.roots.get(id);await this.manager.uninstall(id);if(root)await this.cleanupRetiredRoot(root);return {id,uninstalled:true};});}
  // The replacement/uninstall is already committed. Older Windows packaged hosts
  // can persist a virtualized LocalCache path; never delete outside this runtime's
  // managed root, and never turn optional retirement into a startup failure.
  private async cleanupRetiredRoot(root:string){try{await this.removeRoot(root);}catch{process.stderr.write('CAgent: retired capability files retained; active package is unchanged.\n');}}
  private async removeRoot(root:string){const parent=join(this.options.directory,'capability-packages'),within=relative(parent,root);if(!within||within.startsWith('..')||isAbsolute(within)||!/^package-[^/\\]+$/.test(within))throw new Error('Refusing to remove an unmanaged package path');await rm(root,{recursive:true,force:true});}
  tools():RuntimeCapabilityTool[]{return [...this.registered.values()].flatMap(({manifest,grants})=>manifest.tools.filter(tool=>tool.permissions.every(permission=>grants.includes(permission))).map(tool=>({...structuredClone(tool),packageId:manifest.id,toolId:tool.id,...(manifest.process?{process:true as const,packageDigest:capabilityDigest(JSON.stringify(manifest)),sideEffect:true}:{})})));}
  async invoke(input:unknown,owner:string,signal:AbortSignal){
    if(this.closing)throw new Error('Capability runtime closing');signal.throwIfAborted();
    const {packageId,toolId,args}=invokeInput.parse(input),record=this.registered.get(packageId),tool=record?.manifest.tools.find(tool=>tool.id===toolId);
    if(!record||!tool||!tool.permissions.every(permission=>record.grants.includes(permission)))throw new Error('Capability not installed, configured or authorized');
    const parsed=z.fromJSONSchema(tool.inputSchema as Parameters<typeof z.fromJSONSchema>[0]).parse(args);
    const total=[...this.active.values()].reduce((sum,set)=>sum+set.size,0);if(total>=8)throw new Error('Capability concurrency limit reached');
    const controller=new AbortController(),combined=AbortSignal.any([signal,controller.signal]);let resolve!:()=>void;
    const running={controller,done:new Promise<void>(done=>{resolve=done;})},active=this.active.get(packageId)??new Set();active.add(running);this.active.set(packageId,active);
    try{return await this.adapters.get(record.manifest.adapterId)!.invoke(toolId,parsed,owner,combined);}
    finally{active.delete(running);if(!active.size)this.active.delete(packageId);resolve();}
  }
  async dispose(){this.closing=true;await this.mutation;await this.manager.suspendAll();}
}
