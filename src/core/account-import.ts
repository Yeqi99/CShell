import {isDeepStrictEqual} from 'node:util';
import {z} from 'zod';

const record=z.record(z.string(),z.unknown());
const section=record;
const bundle=z.object({format:z.literal(1),store:section,ai:section,opencode:section.optional(),devices:z.array(record),http:z.array(record),browser:z.record(z.string(),record).optional(),assets:z.record(z.string(),z.string())}).passthrough();
export interface ImportConflict {id:string;category:string;name:string}
export interface ImportOptions {settings:boolean;choices:Record<string,'account'|'source'>}
/** Operates on backend-validated portable bundles only. Policy changes require an explicit choice; device grants and installation state remain local. */
export function planAccountImport(account:unknown,source:unknown,options:ImportOptions){
 const a=bundle.parse(structuredClone(account)),s=bundle.parse(structuredClone(source));
 const conflicts:ImportConflict[]=[];
 const choose=(id:string,category:string,name:string,left:unknown,right:unknown)=>{
  if(isDeepStrictEqual(left,right))return left;
  conflicts.push({id,category,name});return options.choices[id]==='source'?right:left;
 };
 const rows=(value:unknown)=>z.array(record).parse(value??[]);
 const merge=(category:string,left:unknown,right:unknown,key='id')=>{
  const current=rows(left),incoming=rows(right),seen=new Set<string>();
  const identify=(r:Record<string,unknown>)=>z.string().min(1).parse(r[key]);
  for(const row of [...current,...incoming])identify(row);
  for(const list of [current,incoming]){seen.clear();for(const row of list){const id=identify(row);if(seen.has(id))throw Error('来源包含重复条目');seen.add(id);}}
  const result=new Map(current.map(r=>[identify(r),r]));
  for(const row of incoming){const id=identify(row),old=result.get(id);result.set(id,old?choose(`${category}/${id}`,category,String(row.name??row.title??'已有条目').slice(0,100),old,row) as Record<string,unknown>:row);}
  return [...result.values()];
 };
 const oldSecrets=record.parse(a.store.secrets),newSecrets=record.parse(s.store.secrets);
 // A connection and its secret are one conflict decision; never combine different credentials implicitly.
 const decorate=(value:unknown,secrets:Record<string,unknown>)=>rows(value).map(p=>({...p,__secret:secrets[z.string().parse(p.id)]}));
 const profiles=merge('连接',decorate(a.store.profiles,oldSecrets),decorate(s.store.profiles,newSecrets));
 const secrets:Record<string,unknown>={};
 a.store.profiles=profiles.map(p=>{const {__secret,...rest}=p;if(__secret!==undefined)secrets[z.string().parse(p.id)]=__secret;return rest;});a.store.secrets=secrets;
 const oldHosts=z.record(z.string(),z.string()).parse(a.store.hosts),newHosts=z.record(z.string(),z.string()).parse(s.store.hosts);
 for(const [host,identity]of Object.entries(newHosts))if(oldHosts[host]&&oldHosts[host]!==identity)throw Error('来源主机身份与当前账号不一致，请先核对主机身份');
 a.store.hosts={...oldHosts,...newHosts};
 a.store.groups=[...new Set([...z.array(z.string()).parse(a.store.groups),...z.array(z.string()).parse(s.store.groups)])];
 a.store.presets=merge('外观方案',a.store.presets,s.store.presets);
 a.store.monitorViews=merge('监控视图',a.store.monitorViews,s.store.monitorViews);
 if(options.settings){a.store.preferences=s.store.preferences;if(s.store.extensions!==undefined)a.store.extensions=s.store.extensions;}
 if(s.ai.policy!==undefined)a.ai.policy=choose('ai-policy','智能体权限','应用权限与机器范围',a.ai.policy,s.ai.policy);
 a.ai.providers=merge('模型基座',a.ai.providers,s.ai.providers);
 a.ai.habits=merge('习惯记忆',a.ai.habits,s.ai.habits);
 if(options.settings){a.ai.extractionProviderId=s.ai.extractionProviderId;a.ai.textProviderIds=s.ai.textProviderIds;}
 a.opencode={...a.opencode,accounts:merge('OpenCode 账号',a.opencode?.accounts,s.opencode?.accounts)};
 for(const incoming of s.devices){const old=a.devices.find(d=>d.deviceId===incoming.deviceId);if(old&&old.certificate!==incoming.certificate)throw Error('来源 CAgent 身份与当前账号不一致，请先核对设备身份');}
 a.devices=merge('CAgent 设备',a.devices,s.devices,'deviceId');a.http=merge('HTTP 工作区',a.http,s.http);
 const browser={...a.browser};
 for(const [key,value]of Object.entries(s.browser??{})){
  const old=browser[key];
  if(!old){browser[key]=value;continue;}
  const entries=(left:unknown,right:unknown,limit:number)=>{const result=new Map<string,Record<string,unknown>>();for(const row of [...rows(left),...rows(right)]){const url=z.string().parse(row.url),previous=result.get(url);if(!previous||String(row.at)>String(previous.at))result.set(url,row);}return [...result.values()].sort((x,y)=>String(y.at).localeCompare(String(x.at))).slice(0,limit);};
  browser[key]={...old,history:entries(old.history,value.history,300),bookmarks:entries(old.bookmarks,value.bookmarks,200)};
 }
 a.browser=browser;
 // Asset IDs are content hashes validated by the caller before any merge.
 a.assets={...a.assets,...s.assets};
 return {value:a,conflicts,unresolved:conflicts.filter(c=>!options.choices[c.id])};
}
