import { randomBytes, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, lstat, realpath } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { execFile } from 'node:child_process';
import { isDeepStrictEqual, promisify } from 'node:util';
import { z } from 'zod';
import type { ClientVault } from '../core/client/identity';
import type { AgentCapabilityManifest } from '../shared/agent-capability-packages';
import type { CapabilityCatalogEntry } from './capability-catalog';
import type { TrustedCapabilityAdapter } from './capability-runtime';
import { parseCapabilityManifest } from './capability-packages';
import { ManagedWechatValidation, WechatValidationUnknownError } from './managed-wechat-validation';
import { ManagedWechatService, ManagedWechatCallbacks, managedWechatMethods } from './managed-wechat';

export const WECHAT_GROUP_EVIDENCE_SQL = `
  SELECT json_extract(body,'$.data.messageId') AS messageId FROM events
  WHERE json_extract(body,'$.type')='message.received'
    AND json_extract(body,'$.data.accountId')=?
    AND json_extract(body,'$.data.conversationType')='group'
    AND json_extract(body,'$.data.conversationId')=?
    AND json_extract(body,'$.data.recipientId')=?
    AND json_extract(body,'$.data.direction') IN ('incoming','observed','inbound')
    AND json_extract(body,'$.data.nativeMemberId')=?
    AND json_extract(body,'$.data.senderId')=? ORDER BY seq DESC LIMIT 1`;
export const managedWechatVersions=['4.1.15.50','4.1.15.56','4.2.0.12','4.2.0.50'] as const;
export const managedWechatModuleHashes:Record<typeof managedWechatVersions[number],string>={
 '4.1.15.50':'0cf6379405432385a1c442766443450f26a7689f45e53c1b4ad2822061f3113b',
 '4.1.15.56':'e0428a7b691853de496532523c2c09aa095f90941c37c9f4cfb3f137f3c66556',
 '4.2.0.50':'42d3ea2f4274b9e3b22ae0c55213789e9fc621ddf7991ab0a99cee2ea0bbedc1',
 '4.2.0.12':'2b3677c3f932daaa4ef84c8b2acd0aee12cbe5a779ff9e740c370761e5c291ce',
};

export function assertManagedWechatPackage(version:typeof managedWechatVersions[number],moduleHash:string,manifest:AgentCapabilityManifest){
 if(moduleHash!==managedWechatModuleHashes[version]||manifest.id!=='cagent.wechat.v'+version.replaceAll('.','')||manifest.adapterId!==manifest.id)throw Error('WeChat exact version/module/adapter mismatch');
 for (const tool of manifest.tools) {
   const policy = tool.id === 'wechat_operation' ? {permission:'wechat.api',write:false}
     : tool.id.startsWith('wechat_') ? policies[tool.id.slice(7)] : undefined;
   if (!policy || tool.sideEffect !== policy.write || !['wechat.api',policy.permission].every(p=>tool.permissions.includes(p)))
     throw Error('Invalid WeChat tool permission contract');
 }
}
const targets=z.array(z.string().min(1).max(200)).max(100).default([]);
export const managedWechatConfigureSchema=z.object({apiEnabled:z.boolean().default(false),port:z.number().int().min(1024).max(65535).default(8765),subscriptionEnabled:z.boolean().default(false),accountId:z.string().max(200).default(''),receiveTargets:targets,sendTargets:targets,historyTargets:targets,remarkTargets:targets,readContacts:z.boolean().default(false),readSessions:z.boolean().default(false),sendFiles:z.boolean().default(false),momentsRead:z.boolean().default(false),momentsWrite:z.boolean().default(false),receiveTransfers:z.boolean().default(false),receiveRedPackets:z.boolean().default(false)}).strict().superRefine((v,c)=>{if(v.subscriptionEnabled&&(!v.accountId||!v.receiveTargets.length))c.addIssue({code:'custom',message:'Subscription requires account and explicit receive targets'});});
export type ManagedWechatSettings=z.infer<typeof managedWechatConfigureSchema>;
const policies:Record<string,{permission:string;write:boolean}>={address_book:{permission:'wechat.contacts.read',write:false},resolve_contact:{permission:'wechat.contacts.read',write:false},groups:{permission:'wechat.contacts.read',write:false},group_info:{permission:'wechat.contacts.read',write:false},group_members:{permission:'wechat.contacts.read',write:false},sessions:{permission:'wechat.sessions.read',write:false},search_history:{permission:'wechat.history.read',write:false},send_mention:{permission:'wechat.send',write:true},send_quote:{permission:'wechat.send',write:true},status:{permission:'wechat.read',write:false},capabilities:{permission:'wechat.read',write:false},contacts:{permission:'wechat.contacts.read',write:false},conversations:{permission:'wechat.sessions.read',write:false},history:{permission:'wechat.history.read',write:false},moments:{permission:'wechat.moments.read',write:false},moment_detail:{permission:'wechat.moments.read',write:false},moments_interactions:{permission:'wechat.moments.read',write:false},send:{permission:'wechat.send',write:true},send_file:{permission:'wechat.files.send',write:true},receive:{permission:'wechat.events.read',write:false},remark_read:{permission:'wechat.contacts.read',write:false},remark_set:{permission:'wechat.contacts.manage',write:true},moments_publish:{permission:'wechat.moments.publish',write:true},payment_parse:{permission:'wechat.payments.read',write:false},payment_result:{permission:'wechat.payments.read',write:false},transfer_receive:{permission:'wechat.transfers.receive',write:true},red_packet_receive:{permission:'wechat.redpackets.receive',write:true}};
const objectSchema={type:'object' as const,properties:{},additionalProperties:true};
export function buildManagedWechatManifest(options:{wechatVersion:typeof managedWechatVersions[number];version:string;methods:readonly string[];source:AgentCapabilityManifest['source'];files:AgentCapabilityManifest['files']}):AgentCapabilityManifest{
  const id='cagent.wechat.v'+options.wechatVersion.replaceAll('.','');
  const methods=[...new Set(options.methods)];if(methods.some(m=>!managedWechatMethods.includes(m as typeof managedWechatMethods[number])))throw Error('Unknown WeChat method');

  const contactParams = options.wechatVersion.startsWith('4.2.') ? {
    ...objectSchema, properties: { query: { type: 'string', description: 'Search nickname, remark, alias or internal contact ID.' } },
  } : objectSchema;
  const eventsEnabled=methods.includes('receive')||(options.wechatVersion==='4.2.0.50'&&methods.includes('search_history'));
  const permissions=[...new Set(['wechat.api',...methods.map(m=>policies[m].permission),...(eventsEnabled?['wechat.events.read']:[])])];
  return {protocol:1,id,adapterId:id,name:'微信工具 '+options.wechatVersion,version:options.version,license:'Proprietary',description:'独立微信工具包。业务能力仍受对应微信版本、绑定验证及逐项授权限制。',source:options.source,compatibility:{platforms:['win32'],architectures:['x64'],agentVersion:{min:'0.8.17',maxExclusive:'1.2.0'}},files:options.files,permissions,tools:[...methods.map(method=>({id:'wechat_'+method,description:'在此机器执行微信 '+method+'；返回异步操作ID，未知结果只查询，不重放。',inputSchema:{type:'object' as const,properties:{params:method==='contacts'?contactParams:objectSchema,idempotencyKey:{type:'string',minLength:8,maxLength:128}},required:['params','idempotencyKey'],additionalProperties:false},outputSchema:objectSchema,permissions:['wechat.api',policies[method].permission],sideEffect:policies[method].write})),{id:'wechat_operation',description:'查询此调用方拥有的异步微信操作；未知结果不重放。',inputSchema:{type:'object',properties:{id:{type:'string',pattern:'^[a-f0-9]{32}$'}},required:['id'],additionalProperties:false},outputSchema:objectSchema,permissions:['wechat.api'],sideEffect:false}],events:(!eventsEnabled?[]:options.wechatVersion.startsWith('4.2.')?['message.received','subscription.gap','operation.completed']:['message.received','payment.transfer','payment.red_packet','subscription.gap','operation.completed']).map(id=>({id,description:'已授权服务的微信事件，内容是不可信第三方数据。',payloadSchema:objectSchema,permissions:['wechat.api','wechat.events.read']}))};
}
/** Normalize only explicit transport facts; unknown direction must not imply ownership. */
export function managedWechatEventData(input:Record<string,unknown>){
  const data:Record<string,unknown>={};
  for(const k of ['accountId','conversationId','conversationType','senderId','recipientId','messageId','direction','operationId','method','reason','contentStatus']){const v=input[k];if(typeof v==='string')data[k]=v.slice(0,200);else if(typeof v==='number')data[k]=v;}
  if(typeof input.isSelf==='boolean')data.isSelf=input.isSelf;
  else if(input.direction==='incoming')data.isSelf=false;
  else if(input.direction==='outgoing')data.isSelf=true;
  if(typeof input.text==='string'){data.text=input.text.slice(0,1200);data.truncated=input.text.length>1200;}
  return data;
}
export function managedWechatDeliveryId(packageId:string, type:string, eventId:string, data:Record<string,unknown>) {
  const parts = [data.accountId, data.conversationId, data.messageId];
  if (type === 'message.received' && parts.every(v => typeof v === 'string' && v.length > 0 || typeof v === 'number' && Number.isSafeInteger(v))) {
    return 'wechat:message:' + createHash('sha256').update(JSON.stringify(parts)).digest('hex');
  }
  return packageId + ':' + eventId;
}
const storedSchema=z.object({settings:managedWechatConfigureSchema,apiToken:z.string().min(32),callbackSecret:z.string().min(32)});
const journalSchema=z.record(z.string(),z.object({owner:z.string(),digest:z.string(),id:z.string().optional()}));
type Transport=Pick<ManagedWechatService,'verify'|'start'|'stop'|'health'|'capabilities'|'submit'|'operation'> & Partial<Pick<ManagedWechatService,'selectContact'|'selectedContact'|'friendRequest'>>;
export async function createManagedWechatCapability(options:{entry:CapabilityCatalogEntry;directory:string;vault:Pick<ClientVault,'read'|'write'>;authorize:(owner:string)=>boolean;getGrants?:()=>readonly string[];profileReady?:(root:string,configPath:string)=>Promise<boolean>;onEvent?:(source:string,type:string,id:string,data:unknown)=>Promise<unknown>;serviceFactory?:(options:ConstructorParameters<typeof ManagedWechatService>[0])=>Transport;nativeCommand?:(exe:string,args:string[])=>Promise<unknown>;initialize?:(exe:string,config:string)=>Promise<void>}){
  const manifest=parseCapabilityManifest(options.entry.manifestJson!,options.entry.manifestSha256);
  const version=managedWechatVersions.find(value=>value!=='4.1.15.50' && 'cagent.wechat.v'+value.replaceAll('.','')===manifest.id);
  if(manifest.id!==options.entry.id||!version)throw Error('Invalid managed WeChat package');
  assertManagedWechatPackage(version,managedWechatModuleHashes[version],manifest);
  const validatesListener = manifest.tools.some(tool => tool.id === 'wechat_receive');
  const key='managed-'+manifest.id,privateRoot=resolve(options.directory,key),configPath=join(privateRoot,'config.json');
  let stored=await options.vault.read(key,storedSchema)??{settings:managedWechatConfigureSchema.parse({}),apiToken:randomBytes(32).toString('hex'),callbackSecret:randomBytes(32).toString('hex')};
  let journal=await options.vault.read(key+'-operations',journalSchema)??{};let root:string|undefined,grants:readonly string[]=[],service:Transport|undefined,callbacks:ManagedWechatCallbacks|undefined,active=false;let queue:Promise<unknown>=Promise.resolve();
  const validation=new ManagedWechatValidation();let validationUnknown=false, serviceStarted=false;
  const assertNativeSettled=()=>{if(validationUnknown||validation.unknown)throw new WechatValidationUnknownError();};
  const mutate=<T>(fn:()=>Promise<T>)=>{const work=queue.then(fn);queue=work.catch(()=>{});return work;};
  const currentGrants=()=>options.getGrants?.()??grants;
  const allowed=(p:string)=>active&&currentGrants().includes('wechat.api')&&currentGrants().includes(p);
  const make=(path:string)=>options.serviceFactory?.({executable:join(path,'WeixinToolkit.exe'),configPath,files:Object.fromEntries(manifest.files.map(f=>[f.path,f.sha256])),authorize:()=>active&&stored.settings.apiEnabled})??new ManagedWechatService({executable:join(path,'WeixinToolkit.exe'),configPath,files:Object.fromEntries(manifest.files.map(f=>[f.path,f.sha256])),authorize:()=>active&&stored.settings.apiEnabled});
  const stop=async()=>{active=false;serviceStarted=false;await callbacks?.stop();callbacks=undefined;await service?.stop();service=undefined;};
  const privateDirectory=async()=>{await mkdir(privateRoot,{recursive:true,mode:0o700});if(process.platform==='win32'){const run=promisify(execFile);const {stdout}=await run('whoami.exe',['/user','/fo','csv','/nh'],{windowsHide:true});const sid=stdout.match(/S-1-5-[0-9-]+/)?.[0];if(!sid)throw Error('Cannot identify private configuration owner');await run('icacls.exe',[privateRoot,'/inheritance:r','/grant:r','*'+sid+':(OI)(CI)F','*S-1-5-18:(OI)(CI)F'],{windowsHide:true});}};
  const provision=async()=>{
    if(!root)throw Error('Install the WeChat package first');
    await make(root).verify();await privateDirectory();
    if(!(await lstat(configPath).catch(()=>null))){if(options.initialize)await options.initialize(join(root,'WeixinToolkit.exe'),configPath);else await promisify(execFile)(join(root,'WeixinToolkit.exe'),['--init','--config',configPath],{windowsHide:true,timeout:30000,maxBuffer:65536});}
    const base=JSON.parse(await readFile(configPath,'utf8'));if(typeof base.dataDir !== 'string' || (relative(join(privateRoot,'data'),resolve(base.dataDir)) !== '' && relative(await realpath(join(privateRoot,'data')),await realpath(base.dataDir)) !== ''))throw Error('WeChat private data path changed');return base;
  };
  const native=async(args:string[])=>{await provision();const exe=join(root!,'WeixinToolkit.exe');if(args.includes('--validate')){assertNativeSettled();try{return await (options.nativeCommand?options.nativeCommand(exe,[...args,'--config',configPath]):validation.run(exe,[...args,'--config',configPath]));}catch(error){validationUnknown=true;throw error instanceof WechatValidationUnknownError?error:new WechatValidationUnknownError();}}if(options.nativeCommand)return options.nativeCommand(exe,[...args,'--config',configPath]);try{const {stdout}=await promisify(execFile)(exe,[...args,'--config',configPath],{windowsHide:true,timeout:30000,maxBuffer:1048576});return JSON.parse(stdout);}catch{throw Error('WECHAT_NATIVE_CONFIGURATION_FAILED');}};
  const profileReady=async(path:string)=>{if(options.profileReady)return options.profileReady(path,configPath);if(!await lstat(configPath).catch(()=>null))return false;try{const result=await native(['--status']) as {liveEnabled?:boolean;bound?:boolean;validation?:{valid?:boolean}};return result.liveEnabled===true&&result.bound===true&&result.validation?.valid===true;}catch{return false;}};
  const subscriptionAccountValid=(s:ManagedWechatSettings)=>manifest.id!=='cagent.wechat.v42012'||/^wxid_[A-Za-z0-9_]{3,64}$/.test(s.accountId);
  const start=async(allowService=true)=>{
    assertNativeSettled();
    if(!root||!stored.settings.apiEnabled||!currentGrants().includes('wechat.api'))return;
    const base=await provision();service=make(root);
    const s=stored.settings;active=true;
    const subscription=s.subscriptionEnabled&&allowed('wechat.events.read')&&subscriptionAccountValid(s);
    try{callbacks=new ManagedWechatCallbacks({secret:stored.callbackSecret,authorize:()=>subscription&&allowed('wechat.events.read'),onEvent:async({event})=>{
      if(!options.onEvent)return;const data=managedWechatEventData(event.data);
      if (event.type === 'message.received' || event.type.startsWith('payment.')) {
        if (data.accountId !== s.accountId || typeof data.conversationId !== 'string' ||
            !(s.receiveTargets.includes('*') || s.receiveTargets.includes(data.conversationId))) return;
      }
      await options.onEvent('extension.wechat',event.type,managedWechatDeliveryId(manifest.id,event.type,event.id,data),{trust:'untrusted',packageId:manifest.id,...data});
    }});
    const url=await callbacks.start();const config={...base,host:'127.0.0.1',port:s.port,apiToken:stored.apiToken,tls:null,permissions:{enabled:true,experimental:true,readContacts:s.readContacts&&allowed('wechat.contacts.read'),readSessions:s.readSessions&&allowed('wechat.sessions.read'),readMoments:s.momentsRead&&allowed('wechat.moments.read'),publishMoments:s.momentsWrite&&allowed('wechat.moments.publish'),sendFiles:s.sendFiles&&allowed('wechat.files.send'),history:allowed('wechat.history.read')?s.historyTargets:[],receive:allowed('wechat.events.read')?s.receiveTargets:[],send:allowed('wechat.send')||allowed('wechat.files.send')?s.sendTargets:[],sendBlocked:base.permissions?.sendBlocked??[],remarks:allowed('wechat.contacts.manage')||allowed('wechat.contacts.read')?s.remarkTargets:[],receiveTransfers:s.receiveTransfers&&allowed('wechat.transfers.receive'),receiveRedPackets:s.receiveRedPackets&&allowed('wechat.redpackets.receive')},subscription:{enabled:subscription,discover:subscription&&version==='4.2.0.50'&&s.receiveTargets.includes('*'),accountId:s.accountId,targets:s.receiveTargets},webhook:{enabled:subscription,url,secret:stored.callbackSecret,events:manifest.events.map(e=>e.id)}};
    await writeFile(configPath+'.tmp',JSON.stringify(config),{mode:0o600});await rename(configPath+'.tmp',configPath);
    if(!allowService||!await profileReady(root)){await stop();return;}await service.start();serviceStarted=true;}catch(e){await stop();throw e;}
  };
  // Run under the same mutation queue as manual bind, configuration and tool calls.
  const reconcile = () => mutate(async () => {
    const settings = stored.settings;
    if (!root || !settings.apiEnabled || !currentGrants().includes('wechat.api')) return false;
    if (validatesListener && (!settings.subscriptionEnabled || !currentGrants().includes('wechat.events.read'))) return false;
    const snapshot = await native(['--status']) as {
      bound?: boolean; boundPid?: number; boundCreationTime?: string; nativeWorkersIdle?: boolean;
      liveEnabled?: boolean; validation?: {valid?: boolean; reason?: string};
      processes?: {pid: number; version: string; moduleSha256: string; creationTime?: string; accountId?: string}[];
    };
    const attempt = validation.diagnostic();
    if (validationUnknown && attempt?.reason === 'timed out waiting for native cleanup' &&
        attempt.exitCode === 0 && !attempt.signal && snapshot.nativeWorkersIdle === true &&
        snapshot.validation?.valid && snapshot.validation.reason === 'native_receipt_matches_current_process_and_resources' &&
        snapshot.bound && snapshot.liveEnabled) {
      validation.resetAfterProcessExit();
      validationUnknown = false;
    }
    if (snapshot.validation?.valid && snapshot.bound && snapshot.liveEnabled && !(validationUnknown || validation.unknown)) {
      if (active && service) { try { await service.health(); return false; } catch { await stop(); } }
      return snapshot.nativeWorkersIdle !== false;
    }
    if (active) await stop();
    if (!snapshot.bound || !snapshot.liveEnabled || snapshot.processes?.length !== 1) return false;
    const target = snapshot.processes[0];
    const version = managedWechatVersions.find(v => manifest.id === 'cagent.wechat.v' + v.replaceAll('.', ''));
    if (!version || target.version !== version || target.moduleSha256 !== managedWechatModuleHashes[version] ||
        !Number.isSafeInteger(target.pid) || target.pid < 1 || (settings.accountId && target.accountId !== undefined && target.accountId !== settings.accountId) ||
        !target.creationTime || !snapshot.boundCreationTime || snapshot.nativeWorkersIdle !== true) return false;
    const changed = target.pid !== snapshot.boundPid || target.creationTime !== snapshot.boundCreationTime;
    if (validationUnknown || validation.unknown) {
      if (!changed || snapshot.validation?.reason !== 'bound_process_not_current') return false;
      validation.resetAfterProcessExit();
      validationUnknown = false;
    }
    if (validatesListener && !settings.receiveTargets.some(t => t === 'filehelper' || t === '*')) return false;
    if (changed) await native(['--bind','--pid',String(target.pid)]);
    await start(false);
    const result = await native(['--validate','--pid',String(target.pid)]) as {validated?:boolean};
    if (!result?.validated) throw Error('WeChat process validation pending');
    return true;
  });
  const status=()=>({id:manifest.id,permissions:manifest.permissions,settings:structuredClone(stored.settings),running:serviceStarted,subscriptionAccountIssue:stored.settings.subscriptionEnabled&&!subscriptionAccountValid(stored.settings),validationDiagnostic:validation.diagnostic(),validationUnknown:validationUnknown||validation.unknown,configured:stored.settings.apiEnabled,businessAvailability:'requires-native-profile-validation' as const});
  const adapter:TrustedCapabilityAdapter={eventSource:'extension.wechat',inspect:async path=>{root=path;await make(path).verify();return{installed:true,configured:!validationUnknown&&!validation.unknown&&stored.settings.apiEnabled&&await profileReady(path)};},register:async(path,next)=>mutate(async()=>{await stop();root=path;grants=[...next];await start();}),quiesce:()=>mutate(stop),stop:()=>mutate(stop),unregister:()=>mutate(stop),invoke:async(toolId,args,owner,signal)=>mutate(async()=>{
    signal.throwIfAborted();if(!active||!service||!options.authorize(owner))throw Error('WeChat service unauthorized');const tool=manifest.tools.find(t=>t.id===toolId);if(!tool||!tool.permissions.every(p=>currentGrants().includes(p)))throw Error('WeChat operation not granted');
    if(toolId==='wechat_operation'){const {id}=z.object({id:z.string().regex(/^[a-f0-9]{32}$/)}).strict().parse(args);if(!Object.values(journal).some(x=>x.id===id&&x.owner===owner))throw Error('WeChat operation belongs to another caller');return service.operation(id);}
    const method=toolId.replace(/^wechat_/,'');if(!policies[method])throw Error('Unknown WeChat method');const settings=stored.settings;const enabled:Record<string,boolean>={address_book:settings.readContacts,resolve_contact:settings.readContacts,groups:settings.readContacts,group_info:settings.readContacts,group_members:settings.readContacts,sessions:settings.readSessions,contacts:settings.readContacts,conversations:settings.readSessions,moments:settings.momentsRead,moment_detail:settings.momentsRead,moments_interactions:settings.momentsRead,moments_publish:settings.momentsWrite,send_file:settings.sendFiles,transfer_receive:settings.receiveTransfers,red_packet_receive:settings.receiveRedPackets};if(enabled[method]===false)throw Error('WeChat operation disabled in user settings');const input=z.object({params:z.record(z.string(),z.unknown()),idempotencyKey:z.string().min(8).max(128)}).strict().parse(args);const requestKey=createHash('sha256').update(owner+'\0'+input.idempotencyKey).digest('hex'),digest=createHash('sha256').update(JSON.stringify([method,input.params])).digest('hex');
    const prior=journal[requestKey];if(prior){if(prior.digest!==digest||prior.owner!==owner)throw Error('WeChat idempotency conflict');if(!prior.id)throw Error('WeChat previous outcome unknown; do not replay');return service.operation(prior.id);}
    if(Object.keys(journal).length>=10000)throw Error('WeChat ownership journal full');journal={...journal,[requestKey]:{owner,digest}};await options.vault.write(key+'-operations',journal);signal.throwIfAborted();if(!options.authorize(owner))throw Error('WeChat caller revoked');
    const params=['send','send_mention','send_quote','send_file'].includes(method)?{...input.params,idempotencyKey:requestKey}:input.params;
    const result=z.object({id:z.string().regex(/^[a-f0-9]{32}$/)}).passthrough().parse(await service.submit(method,params,requestKey));journal={...journal,[requestKey]:{owner,digest,id:result.id}};await options.vault.write(key+'-operations',journal);return result;
  })};
  const requestLookup=(requestId:string,groupId?:string)=>mutate(async()=>{
    if(manifest.id!=='cagent.wechat.v42012'||!serviceStarted||!service?.friendRequest)throw Error('请先启动微信 4.2 消息服务');
    const {settings}=stored;
    if(!/^[a-f0-9]{64}$/.test(requestId))throw Error('请输入 64 位申请 ID');
    if(groupId&&!/^[0-9]{5,32}@chatroom$/.test(groupId))throw Error('群 ID 格式应为数字加 @chatroom');
    const inScope=(id:string)=>settings.receiveTargets.includes('*')||settings.receiveTargets.includes(id);
    if(!allowed('wechat.events.read')||!settings.subscriptionEnabled||!inScope('fmessage')||(groupId&&!inScope(groupId)))throw Error('请检查事件读取权限及好友申请、目标群的接收范围');
    let raw:unknown;
    try{raw=await service.friendRequest(requestId,groupId);}catch(e){
      if(e instanceof Error&&e.message==='WECHAT_HTTP_404')throw Error('未找到此申请，或当前微信工具包尚未提供申请查询');
      throw e;
    }
    const row=z.object({requestId:z.literal(requestId),accountId:z.literal(settings.accountId),applicantId:z.string(),nativeActionsAvailable:z.boolean().optional(),friend:z.string().optional(),invite:z.string().optional(),groupEvidence:z.object({state:z.string(),messageId:z.string().optional()}).optional()}).parse(raw);
    const lines=['申请人 · '+row.applicantId,'好友关系 · '+(row.friend==='confirmed'?'已确认':row.friend==='pending'?'待处理':'未知')];
    if(groupId){
      lines.push('邀请回执 · '+(row.invite==='invited'?'已邀请':row.invite==='absent'?'未邀请':'未知'),'当前群成员身份 · '+(row.invite==='joined'?'已加入':'未知'));
      let evidence=row.groupEvidence;
      // Earlier 4.2 packages expose the same scoped event journal without the evidence projection.
      if(!evidence){
        try{
          const {DatabaseSync}=await import('node:sqlite');
          const db=new DatabaseSync(join(privateRoot,'data','http.sqlite3'),{readOnly:true});
          try{
            const last=db.prepare(WECHAT_GROUP_EVIDENCE_SQL).get(settings.accountId,groupId,settings.accountId,row.applicantId,row.applicantId);
            evidence=last?{state:'observed_speaking',messageId:String(last.messageId??'')}:{state:'no_matching_event'};
          }finally{db.close();}
        }catch{ /* Unavailable journal leaves evidence unknown. */ }
      }
      lines.push('群发言记录 · '+(evidence?.state==='observed_speaking'?'曾在此群发言'+(evidence.messageId?'（消息 ID '+evidence.messageId+'）':''):evidence?.state==='no_matching_event'?'未找到匹配记录':'未知'));
    }
    return {lines};
  });
  const pickContact=async(alias?:string,id?:string)=>{
    if(!allowed('wechat.events.read')||!serviceStarted||!stored.settings.subscriptionEnabled||!stored.settings.receiveTargets.includes('filehelper'))
      throw Error('请先启用文件传输助手的消息订阅');
    if(id && service?.selectedContact)return service.selectedContact(id);
    if(alias && service?.selectContact)return service.selectContact(alias);
    throw Error('请更新微信工具');
  };
  return{entry:options.entry,adapter,status,reconcile,pickContact,requestLookup,listenerState:async()=>{if(!active||!service)return 'stopped';const health=await service.health() as {listener?:string};return health.listener;},validate:(pid?:number)=>mutate(async()=>{assertNativeSettled();if(pid===undefined){const state=await native(['--status']) as {bound?:boolean;boundPid?:number};if(state.bound===true)pid=state.boundPid;}if(!Number.isSafeInteger(pid)||pid!<1)throw Error('Invalid WeChat PID');if(!stored.settings.apiEnabled||!currentGrants().includes('wechat.api'))throw Error('Validation requires enabled API and API grant');if(validatesListener&&(!currentGrants().includes('wechat.events.read')||!stored.settings.receiveTargets.some(x=>x==='filehelper'||x==='*')))throw Error('Validation requires enabled API, API/event grants and explicit filehelper receive scope');await stop();await start(false);const result=await native(['--validate','--pid',String(pid)]);await start();return result;}),availableStatus:()=>mutate(()=>native(['--status'])),processes:()=>mutate(()=>native(['--status'])),bind:(pid:number)=>mutate(async()=>{assertNativeSettled();if(!Number.isSafeInteger(pid)||pid<1)throw Error('Invalid WeChat PID');await stop();const result=await native(['--bind','--pid',String(pid)]);await start();return result;}),configure:async(input:unknown,refresh?:()=>Promise<unknown>)=>{
    const hot=await mutate(async()=>{
      assertNativeSettled();const settings=managedWechatConfigureSchema.parse(input);if(settings.subscriptionEnabled&&!subscriptionAccountValid(settings))throw Error('请点击「识别当前账号」填入已登录微信的内部账号 ID。');
      const {sendTargets,...rest}=settings;
      const {sendTargets:previousTargets,...previous}=stored.settings;
      if(active&&serviceStarted&&isDeepStrictEqual(rest,previous)){
        if(isDeepStrictEqual(previousTargets,sendTargets))return true;
        // Each native send worker reads this file. The listener retains its callback.
        const config=JSON.parse(await readFile(configPath,'utf8'));
        const next={...stored,settings};
        config.permissions.send=allowed('wechat.send')||allowed('wechat.files.send')?sendTargets:[];
        const temp=configPath+'.send.tmp';
        await writeFile(temp,JSON.stringify(config),{mode:0o600});
        await options.vault.write(key,next);
        try{await rename(temp,configPath);}
        catch(error){await options.vault.write(key,stored);throw error;}
        stored=next;
        return true;
      }
      await stop();
      stored={...stored,settings};
      await options.vault.write(key,stored);
      if(root)await provision();
      await start();
      return false;
    });
    if(!hot)await refresh?.();
    return status();
  },shutdown:()=>mutate(stop)};
}

