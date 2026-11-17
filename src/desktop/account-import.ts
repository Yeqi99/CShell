import {app} from 'electron';
import {stat,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {z} from 'zod';
import {readAccountSource} from './account-source-reader';
import {hasAccountSource} from '../core/account-source-discovery';
import {planAccountImport} from '../core/account-import';
import {clearGuestCache,guestCacheEntries} from '../core/guest-cache';
import type {CloudSync} from '../core/cloud-sync';
import type {DesktopAccountProfiles} from '../core/desktop-account-profiles';
import type {AccountSource,AccountSourcePreview} from '../shared/account-import';

export function registerAccountImports(handle:(name:string,fn:(...args:any[])=>any)=>void,cloud:CloudSync,profiles:DesktopAccountProfiles,validate:(v:unknown)=>unknown,snapshot:()=>Promise<unknown>,assertIdle:()=>void){
 const kind=z.enum(['opensource','guest']);
 let preview:{token:string;account:string;source:AccountSource;digest:string;expires:number}|undefined;
 const account=()=>{const id=cloud.accountId();if(!id||cloud.activationDeferred())throw Error('请先登录账号');return id;};
 const path=(source:AccountSource)=>source==='guest'?profiles.directory('guest'):join(app.getPath('appData'),'CShell');
 const read=async(source:AccountSource)=>{
  account();const directory=path(source);
  if(await realpath(directory)===await realpath(app.getPath('userData')))throw Error('不能把当前工作区作为导入来源');
  const value=await readAccountSource(directory,source==='guest'?'pro':'opensource');validate(value);return value;
 };
 const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
 handle('account:clear-guest',async(confirmation)=>{
  z.literal('clear-guest-local-only').parse(confirmation);const id=account();
  // Active connections belong to the signed-in profile. Only imports and
  // account switches replace that profile's live data and require idle sessions.
  await cloud.withAccountWorkspace(id,async()=>{
   await clearGuestCache(profiles.directory('guest'),app.getPath('userData'));
  });preview=undefined;
 });
 handle('account:has-guest-cache',async()=>{
  account();
  for(const entry of guestCacheEntries){
   try{await stat(join(path('guest'),entry));return true;}
   catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  }
  return false;
 });
 const scanSources=async()=>{
  const result:AccountSource[]=[];
  for(const source of ['opensource','guest'] as const){
   const dir=path(source);
   try{if(await hasAccountSource(dir,()=>readAccountSource(dir,source==='guest'?'pro':'opensource',true)))result.push(source);}
   catch{throw Error(source==='guest'?'未能读取 Pro 未登录工作区，请重试。':'未能读取 CShell 开源版的本机配置，请重试。');}
  }return result;
 };
 const scanning=new Map<string,Promise<AccountSource[]>>();
 handle('account:sources',async()=>{
  const id=account();
  let pending=scanning.get(id);
  if(!pending){pending=scanSources().finally(()=>scanning.delete(id));scanning.set(id,pending);}
  const result=await pending;
  if(account()!==id)throw Error('账号已改变，请重新检查');
  return result;
 });
 handle('account:source-preview',async(input)=>{
  const source=kind.parse(input),id=account(),value=await read(source);
  if(account()!==id)throw Error('账号已改变，请重新检查');
  const plan=planAccountImport(await snapshot(),value,{settings:false,choices:{}}),s=z.object({store:z.object({profiles:z.array(z.unknown()),presets:z.array(z.unknown()),monitorViews:z.array(z.unknown())}),ai:z.object({providers:z.array(z.unknown()),habits:z.array(z.unknown()).optional()}),opencode:z.object({accounts:z.array(z.unknown())}).optional(),tavily:z.object({accounts:z.array(z.unknown())}).optional(),desktopLooks:z.object({looks:z.record(z.string(),z.unknown())}).optional(),devices:z.array(z.unknown()),http:z.array(z.unknown())}).parse(value);
  preview={token:randomUUID(),account:id,source,digest:digest(value),expires:Date.now()+10*60*1000};
  const result:AccountSourcePreview={source,token:preview.token,conflicts:plan.conflicts,counts:[{label:'连接',count:s.store.profiles.length+s.devices.length},{label:'模型基座',count:s.ai.providers.length},{label:'OpenCode 账号',count:s.opencode?.accounts.length??0},{label:'Tavily 账号',count:s.tavily?.accounts.length??0},{label:'习惯记忆',count:s.ai.habits?.length??0},{label:'外观与视图',count:s.store.presets.length+s.store.monitorViews.length+Object.values(s.desktopLooks?.looks??{}).filter(v=>v!==null).length},{label:'HTTP 工作区',count:s.http.length}]};return result;
 });
 handle('account:source-import',async(token,settings,choices)=>{
  z.string().uuid().parse(token);z.boolean().parse(settings);const decisions=z.record(z.string().max(200),z.enum(['account','source'])).parse(choices);
  const pending=preview,id=account();if(!pending||pending.token!==token||pending.account!==id||pending.expires<Date.now())throw Error('预览已过期，请重新检查来源');
  assertIdle();
  const source=await read(pending.source);if(digest(source)!==pending.digest)throw Error('来源配置已改变，请重新检查后载入');
  await cloud.importLocal(id,async current=>{assertIdle();const plan=planAccountImport(current,source,{settings,choices:decisions});if(plan.unresolved.length)throw Error('请为冲突条目选择保留方式；账号内容可能已更新，请重新检查');return plan.value;});
  preview=undefined;
 });
}
