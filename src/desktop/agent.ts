import {createTransferProgress} from '../shared/transfer-progress';
import type {Transfer} from '../shared/contracts';
import type {LinuxWorkspaceService} from '../core/linux-workspace';
import { app,dialog } from 'electron';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {basename} from 'node:path';
import {open,link,unlink} from 'node:fs/promises';
import {safeName} from '../core/paths';
import {randomUUID} from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { callAgent, discoverAgent } from '../agent/control';
import { agentCallSchema, type AgentTarget } from '../shared/agent';
import { pluginEnabled } from '../shared/plugins';
import type { Store } from '../core/store';
import type { ClientProvider } from '../core/client/provider';
import type { ConnectionRegistry } from '../core/connections/registry';
import { ClientVault } from '../core/client/identity';
import { clientCodec } from './client-app';
import { DesktopViews } from '../core/desktop-views';
import type { DesktopTicket } from '../shared/agent-desktop';
import type { DesktopViewEvent } from '../shared/desktop-view';
import { connectDesktop } from '../core/desktop-client';
import { DesktopTargets } from '../core/desktop-targets';
import { desktopViewStartSchema } from '../shared/desktop-view';
import { DesktopAutomation } from '../core/desktop-automation';
import { decodeDesktopFrame } from './desktop-frame-decoder';


export async function registerAgent(
  handle: (name: string, fn: (...args: any[]) => any) => void,
  store: Store,
  provider: ClientProvider,
  registry: ConnectionRegistry,
  publish: (event: DesktopViewEvent) => void,
  linuxWorkspace?: LinuxWorkspaceService,
  publishTransfer: (state: Transfer) => void = () => {},
) {
  const directory = process.env.CSHELL_AGENT_DATA;
  const bundledAvailable = false;
  const guard = () => {
    if (!pluginEnabled(store.plugins(), 'agent')) throw new Error('请先启用 cagent 扩展');
  };
  const machines=new Map<string,{resourceId:string;fingerprint:string;label:string}>();
  const machineTarget=(target:string)=>{const m=machines.get(target);return m&&provider.list().some(d=>d.deviceId===m.resourceId&&d.fingerprint===m.fingerprint)?m:undefined;};
  const activeTarget = (target: string) => machineTarget(target) ??
    registry
      .activeTargets()
      .find((t) => t.sessionId === target && t.providerId === 'cshell.client');
  const targets = new DesktopTargets({ active: activeTarget, devices: () => provider.list() });
  const toolListeners=new Set<(event:DesktopViewEvent)=>void>(),toolViews=new Set<string>();
  const views = new DesktopViews({
    publish:event=>{for(const listener of toolListeners)listener(event);if(!toolViews.has(event.id))publish(event);},
    onStopped: (id) => targets.release(id),
    authorize: (target) => {
      if(target==='local')guard();
      if (target !== 'local') targets.resolve(target);
    },
    open: async (input) => {
      if (input.target === 'local') {
        const status = (await callAgent('client.status', undefined, directory)) as {
          deviceId: string;
        };
        const desktop = (await callAgent('desktop.status', undefined, directory)) as {
          config: { bindAddress: string; directListener: boolean }; qualityModes?:string[];
        };
        if(input.quality.unlimited&&!desktop.qualityModes?.includes('unlimited'))throw new Error('无上限画质需要更新受控端 CAgent；可先选择高画质连接。');
        const ticket = (await callAgent(
          'desktop.open',
          { control: input.control, quality: input.quality },
          directory,
        )) as DesktopTicket;
        const bind = desktop.config.directListener?desktop.config.bindAddress:'127.0.0.1',
          host = bind === '0.0.0.0' ? '127.0.0.1' : bind === '::' ? '::1' : bind;
        return {
          ticket,
          host,
          identity: status.deviceId,
          local: true,
          close: () => callAgent('desktop.close', { id: ticket.id }, directory),
        };
      }
      const deviceId = targets.resolve(input.target);
      const device = provider.list().find((d) => d.deviceId === deviceId);
      if (!device) throw new Error('未找到已验证的 Agent');
      if(input.quality.unlimited){const capabilities=await provider.call(deviceId,{method:'desktop.status'}) as {qualityModes?:string[]};if(!capabilities.qualityModes?.includes('unlimited'))throw new Error('无上限画质需要更新远端 CAgent；可先选择高画质连接。');}
      let ticket: DesktopTicket;
      try {
        ticket = await provider.call(deviceId, {method:'desktop.open', params:{control:input.control, quality:input.quality, transport:'management', mediaTransport:'udp'}}) as DesktopTicket;
      } catch (error) {
        if (!/unrecognized|unknown|unsupported/i.test(String(error)) || !/mediaTransport/.test(String(error))) throw error;
        ticket = await provider.call(deviceId, {method:'desktop.open', params:{control:input.control, quality:input.quality, transport:'management'}}) as DesktopTicket;
      }
      return {
        ticket,
        host: device.host,
        identity: device.deviceId,
        local: false,
        connect: async () => {
          const controller = new AbortController(),
            timer = setTimeout(() => controller.abort(), 15000);
          try {
            targets.resolve(input.target);
            const attempt=async()=>{
              const stream=await provider.openDesktopStream(deviceId,controller.signal);
              try{return await connectDesktop(ticket,{host:device.host,expectedHostIdentity:device.deviceId,stream});}
              catch(error){stream.destroy();throw error;}
            };
            try{return await attempt();}catch(error){
              if(ticket.mediaTransport!=='udp')throw error;
              await provider.call(deviceId,{method:'desktop.close',params:{id:ticket.id}},controller.signal);
              ticket=await provider.call(deviceId,{method:'desktop.open',params:{control:input.control,quality:input.quality,transport:'management',mediaTransport:'tcp'}},controller.signal) as DesktopTicket;
              return attempt();
            }
          } finally {
            clearTimeout(timer);
          }
        },
        close: () => {
          const controller = new AbortController(),
            timer = setTimeout(() => controller.abort(), 2000);
          return provider
            .call(
              deviceId,
              { method: 'desktop.close', params: { id: ticket.id } },
              controller.signal,
            )
            .finally(() => clearTimeout(timer));
        },
      };
    },
  });
  const stopTarget = (target: string) =>
    Promise.allSettled(
      targets.stopTarget(target).map((id) => views.stop(id, 'Agent 连接已由用户关闭')),
    );
  const offDisconnect = provider.onExplicitDisconnect((target) => {
    void stopTarget(target);
  });
  handle('desktop:view-start', async (raw) => {
    const input = desktopViewStartSchema.parse(raw);
    if(input.target==='local')guard();
    targets.bind(input.id, input.target);
    try {
      return await views.start(input);
    } catch (error) {
      targets.release(input.id);
      throw error;
    }
  });
  handle('desktop:view-stop', (id) => views.stop(id));
  handle('desktop:view-input', (id, value, generation) => views.input(id, value, generation));
  handle('desktop:view-release', (id, generation) => views.release(id, generation));
  handle('desktop:view-ack', (id, sequence, decoded, decodeMs, generation) =>
    views.ack(id, sequence, decoded, decodeMs, generation),
  );
  handle('desktop:view-quality', (id, value, generation) => views.quality(id, value, generation));
  handle('agent:targets', async () => {
    guard();
    let local: AgentTarget = {
      id: 'local',
      name: '本机 cagent',
      local: true,
      available: false,
      bundledApp: bundledAvailable,
      reason: 'Agent 未运行',
    };
    try {
      if (await discoverAgent(directory)) {
        await callAgent('client.status', undefined, directory);
        local = { ...local, available: true, reason: undefined };
      }
    } catch {
      local.reason = 'Agent 控制服务无法连接';
    }
    return [
      local,
      ...registry
        .activeTargets()
        .filter((t) => t.providerId === 'cshell.client')
        .map((t) => ({ id: t.sessionId, name: t.label, local: false, available: true })),
    ];
  });
  handle('agent:launch', async () => {
    guard();
    throw new Error('CAgent 已改为独立应用，请从开始菜单打开 CAgent');
  });
  handle('agent:machine-open',async(raw)=>{
    const id=z.string().uuid().parse(raw),device=provider.list().find(d=>d.deviceId===id);
    if(!device)throw new Error('设备身份不可用，请重新核对并连接');
    await provider.call(id,{method:'agent.shells'});
    const existing=[...machines].find(([,m])=>m.resourceId===id&&m.fingerprint===device.fingerprint);
    const target=existing?.[0]??'machine:'+randomUUID();
    machines.set(target,{resourceId:id,fingerprint:device.fingerprint,label:device.name});
    return {id:target,name:device.name,local:false,available:true};
  });
  const remoteCall=(key:string,call:import('../shared/agent').AgentCall,signal?:AbortSignal)=>{
    if(key.startsWith('ssh:')&&linuxWorkspace)return linuxWorkspace.call(z.string().uuid().parse(key.slice(4)),call,signal);
    const current=activeTarget(key);if(!current)throw new Error('机器连接已关闭');return provider.call(current.resourceId,call,signal);
  };
  const checkTarget=(key:string)=>{if(key.startsWith('ssh:')&&linuxWorkspace){linuxWorkspace.validate(z.string().uuid().parse(key.slice(4)));return;}if(!activeTarget(key))throw new Error('机器连接已关闭');};
  const downloads=new Map<string,AbortController>();
  const fileProgress=(id:string,target:string,name:string,direction:Transfer['direction'])=>{
    return createTransferProgress(id,target,name,direction,publishTransfer);
  };
  handle('agent:file-cancel',(id:unknown)=>{downloads.get(z.string().uuid().parse(id))?.abort();});
  handle('agent:file-paste',async(target:unknown,input:unknown)=>{
    const key=z.string().parse(target),p=z.object({id:z.string().uuid(),root:z.string().uuid(),path:z.string().max(4096)}).strict().parse(input);
    checkTarget(key);
    if(process.platform!=='win32')throw new Error('此系统请使用拖放或上传文件');
    if(downloads.size>=4||downloads.has(p.id))throw new Error('传输任务已满');
    const controller=new AbortController();downloads.set(p.id,controller);const completed:string[]=[];let uploadId='',sent=0;const progress=fileProgress(p.id,key,'剪贴板文件','upload');let finished=false;
    const call=(method:string,params:unknown)=>remoteCall(key,{method,params} as any,controller.signal);
    try{
      const {stdout}=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-STA','-Command',"[Console]::OutputEncoding=[Text.UTF8Encoding]::new(); Add-Type -AssemblyName System.Windows.Forms; $items=@([Windows.Forms.Clipboard]::GetFileDropList()); ConvertTo-Json -InputObject $items -Compress"],{windowsHide:true,timeout:10000,maxBuffer:1024*1024,signal:controller.signal});
      const paths=z.array(z.string().min(1).max(32768)).max(100).parse(JSON.parse(stdout.trim()));
      if(!paths.length)throw new Error('剪贴板中没有文件，请先在资源管理器中复制文件');
      for(const local of paths){
        controller.signal.throwIfAborted();const name=basename(local);safeName(name);const file=await open(local,'r');
        try{const stat=await file.stat();if(!stat.isFile())throw new Error('暂不支持整个文件夹，请先打包：'+name);
          const start=await call('files.uploadStart',{root:p.root,path:(p.path==='/'?'':p.path)+'/'+name,size:stat.size}) as {id:string;chunkSize:number};uploadId=start.id;
          const buffer=Buffer.alloc(Math.min(65536,start.chunkSize));let offset=0;
          while(offset<stat.size){controller.signal.throwIfAborted();const {bytesRead}=await file.read(buffer,0,Math.min(buffer.length,stat.size-offset),offset);if(!bytesRead)throw new Error('本地文件已改变');
            const r=await call('files.uploadChunk',{id:uploadId,offset,data:buffer.subarray(0,bytesRead).toString('base64')}) as {next:number};if(r.next!==offset+bytesRead)throw new Error('远端文件位置无效');offset=r.next;progress.update(sent+offset,0,false,name);}
          sent+=stat.size;
          const after=await file.stat();if(after.size!==stat.size||after.mtimeMs!==stat.mtimeMs)throw new Error('本地文件已改变，请重新复制');
          await call('files.uploadFinish',{id:uploadId});uploadId='';completed.push(name);
        }finally{await file.close();}
      }
      finished=true;return {completed};
    }catch(error){throw new Error((completed.length?'已完成 '+completed.length+' 个文件；':'')+(error as Error).message);}
    finally{progress.finish(finished?'done':controller.signal.aborted?'cancelled':'failed');if(uploadId){await remoteCall(key,{method:'files.uploadCancel',params:{id:uploadId}}).catch(()=>{});}downloads.delete(p.id);}
  });
  handle('agent:file-download',async(target:unknown,input:unknown)=>{
    const key=z.string().parse(target),p=z.object({id:z.string().uuid(),root:z.string().uuid(),path:z.string().min(1).max(4096),name:z.string().min(1).max(255)}).strict().parse(input);safeName(p.name);
    checkTarget(key);
    if(downloads.size>=4||downloads.has(p.id))throw new Error('下载任务已满');const controller=new AbortController();downloads.set(p.id,controller);let temporary='',finished=false;let progress:ReturnType<typeof fileProgress>|undefined;
    try{const save=await dialog.showSaveDialog({defaultPath:p.name,title:'下载远端文件'});if(save.canceled||!save.filePath)return {cancelled:true};controller.signal.throwIfAborted();
      progress=fileProgress(p.id,key,p.name,'download');
      temporary=save.filePath+'.cagent-'+p.id+'.part';const h=await open(temporary,'wx',0o600);
      try{let offset=0,version:string|undefined;for(;;){controller.signal.throwIfAborted();const raw=await remoteCall(key,{method:'files.read',params:{root:p.root,path:p.path,offset,version}},controller.signal);const r=z.object({data:z.string().max(349528),size:z.number().int().nonnegative(),version:z.string(),next:z.number().int().nonnegative(),done:z.boolean()}).parse(raw);const buffer=Buffer.from(r.data,'base64');if(r.next!==offset+buffer.length||(!r.done&&!buffer.length))throw new Error('远端文件分块无效');await h.writeFile(buffer);offset=r.next;version=r.version;progress.update(offset,r.size,true);if(r.done){if(offset!==r.size)throw new Error('远端文件长度不一致');break;}}await h.sync();}finally{await h.close();}
      controller.signal.throwIfAborted();checkTarget(key);await link(temporary,save.filePath);finished=true;return {};
    }finally{progress?.finish(finished?'done':controller.signal.aborted?'cancelled':'failed');downloads.delete(p.id);if(temporary)await unlink(temporary).catch(()=>{});}
  });
  handle('agent:machine-close',async(target)=>{await stopTarget(z.string().parse(target));machines.delete(target);});
  handle('agent:call', async (target, raw) => {
    if(target==='local')guard();
    const call = agentCallSchema.parse(raw);
    if (call.method === 'desktop.open') throw new Error('请从远程桌面入口连接');
    if (target === 'local') return callAgent(call.method, call.params, directory);
    if(typeof target==='string'&&target.startsWith('ssh:')&&linuxWorkspace)return remoteCall(target,call);
    const active = activeTarget(target);
    if (!active) throw new Error('请选择仍在连接的 Agent');
    return provider.call(active.resourceId, call);
  });
  handle('agent:shells', (id) => provider.shells(z.string().uuid().parse(id)));
  handle('agent:import', async () => {
    guard();
    const legacy = new ClientVault(
      join(app.getPath('appData'), 'CShell Client', 'client'),
      clientCodec,
    );
    const records: Record<string, unknown> = {};
    for (const name of ['identity', 'access', 'peers', 'listener']) {
      const record = await legacy.read(name, z.unknown());
      if (record !== undefined) records[name] = record;
    }
    if (!records.identity) throw new Error('没有发现旧 Client 身份');
    records.peers ??= [];
    await callAgent('legacy.import', { ...records, confirm: true }, directory);
  });
  for (const name of ['status', 'access', 'info', 'start', 'stop', 'revoke'])
    handle('client:' + name, (params) => {
      guard();
      return callAgent('client.' + name, params, directory);
    });
  const desktopTools=new DesktopAutomation({
    validate:key=>{registry.describe(key);checkTarget(key);},
    start:async input=>{toolViews.add(input.id);try{targets.bind(input.id,input.target);return await views.start(input);}catch(error){targets.release(input.id);toolViews.delete(input.id);throw error;}},
    stop:async id=>{try{await views.stop(id);}finally{toolViews.delete(id);targets.release(id);}},
    input:(id,input,generation)=>views.input(id,input,generation),release:(id,generation)=>views.release(id,generation),
    ack:(id,sequence,decoded,decodeMs,generation)=>views.ack(id,sequence,decoded,decodeMs,generation),
    subscribe:listener=>{toolListeners.add(listener);return()=>{toolListeners.delete(listener);};},
    status:async(key,signal)=>{const raw=await registry.agent(key)({method:'desktop.status'},signal);return z.object({enabled:z.boolean(),viewAllowed:z.boolean(),controlAllowed:z.boolean(),busy:z.boolean(),implementation:z.string().max(100).optional(),lastFailure:z.union([z.string().max(2000),z.object({stage:z.string().max(100),code:z.string().max(100),message:z.string().max(2000),at:z.string().max(100)})]).optional()}).parse(raw);},
    decode:decodeDesktopFrame,
  });
  return {
    desktopTool:(key:string,action:string,input:unknown,signal:AbortSignal,authorize?:()=>void)=>desktopTools.invoke(key,action,input,signal,authorize),
    stopTarget,
    browserTarget: async(key:string)=>{
      if(key==='local'){guard();const s=await callAgent('client.status',undefined,directory) as {deviceId:string};return {key:'agent:'+s.deviceId,call:(method:string,params?:unknown)=>{guard();return callAgent(method,params,directory);},validate:guard};}
      checkTarget(key);const target=activeTarget(key);if(!target)throw new Error('机器连接已关闭');
      const device=provider.list().find(d=>d.deviceId===target.resourceId);if(!device)throw new Error('设备身份不可用');
      const tunnel=await provider.browserTransport(device.deviceId);
      return {key:'agent:'+device.deviceId+':'+device.fingerprint,call:(method:string,params?:unknown)=>{checkTarget(key);return tunnel.call(method,params);},validate:()=>{checkTarget(key);tunnel.validate();},close:tunnel.close};
    },
    dispose: () => {
      offDisconnect();
      return views.dispose();
    },
  };
}
