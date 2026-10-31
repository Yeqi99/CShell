import {createLanRegistration} from './lan-registration';
import {ManagedEnvironment,ManagedScripts} from './managed-classroom';
import {AccountNetwork} from './account-network';
import {CagentCloud} from './cloud';
import { machineSnapshot } from './machine-info';
import {IdeService} from './ide';
import {AgentBrowserNetwork} from './browser-network';
import {CodingService} from './coding';
import {LinuxVisualApps} from './linux-visual-apps';
import {loadPrivateWechat,loadProcessExtensions} from '../core/custom-extensions';
import {AgentFiles} from './files';
import {AgentUpdater} from './update';
import {startupState,setStartup} from './startup';
import { access } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { networkInterfaces } from 'node:os';
import { X509Certificate, createPublicKey ,randomBytes} from 'node:crypto';
import { z } from 'zod';
import { ClientServer } from '../core/client/server';
import { ClientVault } from '../core/client/identity';
import { accessSchema } from '../core/client/password';
import { clientShellSchema, clientAccessSchema, clientEndpointSchema } from '../shared/client';
import { AgentTerminalProvider } from '../core/agent-terminal';
import { agentDirectory, agentCodec } from './storage';
import { startAgentControl } from './control';
import { AgentWslService } from './wsl';
import { WslNetworkSettings } from './wsl-network';
import { HostingService } from './hosting';
import { AgentRelayService } from './relay';
import { AgentReverseRelayService } from './relay-reverse';
import { hostingConfigSchema } from '../shared/agent-hosting';
import { AgentApplicationService } from './applications';
import { CagentAutomation } from './automation';
import { createManagedWechatCapability } from './managed-wechat-capability';
import { managedWechatCatalog } from './managed-wechat-catalog';
import { CagentAssistant } from './assistant';
import { CapabilityRuntime } from './capability-runtime';
import { createDesktopCapability } from './desktop-capability';
import { version as agentVersion } from '../../package.json';
import { agentMethods } from '../shared/agent';
import { SafeAgentUpdate } from './safe-update';

const legacySchema = z
  .object({
    confirm: z.literal(true),
    identity: z
      .object({
        id: z.string().uuid(),
        key: z.string().min(100).max(16384),
        certificate: z.string().min(100).max(16384),
      })
      .strict(),
    access: accessSchema.optional(),
    peers: z
      .array(
        z
          .object({
            fingerprint: z.string().max(100),
            name: z.string().min(1).max(80),
            shells: z.array(clientShellSchema).min(1).max(6),
            allowHttp: z.boolean().default(false),
            allowManage: z.boolean().default(false),
            allowHosting: z.boolean().default(false),
            allowRelay: z.boolean().default(false),
          })
          .strict(),
      )
      .max(32),
    listener: z
      .object({
        bind: z.string().max(253),
        port: z.number().int().min(1024).max(65535),
        advertisedHost: z.string().max(253).optional(),
        advertisedPort: clientEndpointSchema.shape.port.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
const idInput = (params: unknown) => z.object({ id: z.string().uuid() }).strict().parse(params).id;
async function finishLegacyImport(vault: ClientVault, input: z.infer<typeof legacySchema>) {
  await vault.write('peers', input.peers);
  if (input.access) await vault.write('access', input.access);
  if (input.listener) await vault.write('listener', input.listener);
  await vault.write('identity', input.identity);
  await vault.write('legacy-import-pending', null);
}
export async function createAgentRuntime(
  options: { directory?: string; terminal?: AgentTerminalProvider; onClose?:()=>void; desktopExecutable?:string; extraPackages?:ConstructorParameters<typeof CapabilityRuntime>[0]['extraPackages'] } = {},
) {
  let updateCommitToken=process.env.CSHELL_AGENT_UPDATE_COMMIT;
  delete process.env.CSHELL_AGENT_UPDATE_COMMIT;
  if(updateCommitToken&&!/^[a-f0-9]{64}$/.test(updateCommitToken))throw Error('更新启动凭据无效');
  let updateAdmissionClosed=!!updateCommitToken;
  let activeDispatches=0, queuedMutations=0;
  const files=new AgentFiles();
  const visual=new LinuxVisualApps();
  const directory = options.directory ?? agentDirectory(); const updater=new AgentUpdater(directory,agentVersion);
  let canImportLegacy = false;
  try {
    await access(join(directory, 'identity.enc'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    canImportLegacy = true;
  }
  const codec=await agentCodec(directory);
  const vault = new ClientVault(directory, codec);
  const interruptedImport = await vault.read('legacy-import-pending', legacySchema.nullable());
  if (interruptedImport) {
    await finishLegacyImport(vault, interruptedImport);
    canImportLegacy = false;
  }
  let server: ClientServer;
  const terminal = options.terminal ?? new AgentTerminalProvider((event) => server.event(event));
  terminal.setUpdateGuard(()=>updateAdmissionClosed);
  const shells = async () =>
    (await terminal.shells()).map((s) => ({
      shell: s.environment === 'wsl' ? 'wsl' : s.id,
      label: s.label,
      ...(s.distribution ? { distribution: s.distribution } : {}),
    }));
  server = new ClientServer(vault, terminal, {
    http:(request,signal)=>accountNetwork.http(request,signal),
    manage: (method, params, signal, owner) => dispatch(method, params, signal, false, owner),
    desktopStream: async (socket,owner) => {if(updateAdmissionClosed){socket.destroy();return;}await desktop.service.acceptAuthenticated(socket,owner);},
    shells,
    execute: (input, signal) => terminal.execute(input, signal),
  });
  await server.load();
  const managedEnvironment=new ManagedEnvironment(vault,values=>terminal.setManagedEnvironment(values));await managedEnvironment.load();
  const managedScripts=new ManagedScripts((owner,shell)=>{if(owner==='local')return true;const status=server.status(),peer=status.peers.find(p=>p.fingerprint===owner);return server.managementAllowed(owner)&&(!shell||!!peer?.shells.includes(shell as any)&&!!status.allowedShells?.includes(shell as any));},(input,signal,output)=>terminal.execute(input,signal,output));
  const applications = new AgentApplicationService(vault, (owner) =>
    server.managementAllowed(owner));
  await applications.load();
  const desktopIdentity=server.status().deviceId;
  const desktop=await createDesktopCapability({identity:desktopIdentity,nativeExecutable:options.desktopExecutable??join(dirname(resolve(process.argv[1]??process.execPath)),'cagent-desktop.exe'),vault,authorize:owner=>!updateAdmissionClosed&&server.status().deviceId===desktopIdentity&&(owner==='local'||server.managementAllowed(owner))});
  let automation:CagentAutomation;
  const managedWechat=await Promise.all(managedWechatCatalog.map(entry=>createManagedWechatCapability({entry,directory,vault,getGrants:()=>packages.list().find(p=>p.id===entry.id)?.grants??[],authorize:owner=>!updateAdmissionClosed&&(owner==='local'||server.managementAllowed(owner)),onEvent:async(source,type,id,payload)=>{
    if(!automation)throw Error('自动化仍在启动，请稍后重试事件');
    if(source!=='extension.wechat'||!['message.received','payment.transfer','payment.red_packet','subscription.gap','operation.completed'].includes(type))throw Error('未知扩展事件');
    return automation.emit(source,type,id,payload);
  }})));
  const privateWechat=await loadPrivateWechat();
  const wechat=privateWechat ? await privateWechat.module.createWechatCapability({directory,runtime:privateWechat.runtime,authorize:owner=>owner==='local'||server.managementAllowed(owner)}) : undefined;
  const customProcesses=await loadProcessExtensions(undefined,id=>process.stderr.write(`CAgent: custom extension ${id} failed verification; reinstall its package.\n`));
  const packages=new CapabilityRuntime({directory,vault,applications,agentVersion,extraPackages:[...desktop.extraPackages,...managedWechat,...(wechat?.extraPackages??[]),...customProcesses,...options.extraPackages??[]]});
  await packages.load();
  const processProvisioned=await vault.read('process-provisioned',z.record(z.string(),z.string()))??{};
  for(const pack of customProcesses){
    // Import stages bytes; separate grants are required. Do not undo explicit uninstalls.
    const token=`${pack.entry.manifestSha256}:${pack.installToken}`;
    if(processProvisioned[pack.entry.id]!==token){
      if(packages.list().some(item=>item.id===pack.entry.id))await packages.grant({id:pack.entry.id,permissions:[]});
      await packages.install({id:pack.entry.id,confirm:true});
      processProvisioned[pack.entry.id]=token;
    }
  }
  await vault.write('process-provisioned',processProvisioned);
  if(wechat&&!(await vault.read('wechat-private-provisioned',z.boolean()))){
    if(!packages.list().some(item=>item.id==='cagent.wechat'))await packages.install({id:'cagent.wechat',confirm:true});
    await vault.write('wechat-private-provisioned',true);
  }
  // Provision the Windows distribution's native desktop once, without granting access.
  // Remember the decision so an explicit uninstall remains effective on restart.
  if (desktop.extraPackages.length && !(await vault.read('desktop-builtin-provisioned', z.boolean()))) {
    if (!packages.list().some(item => item.id === 'cagent.desktop')) {
      await packages.install({id:'cagent.desktop',confirm:true});
      await packages.grant({id:'cagent.desktop',permissions:['desktop.view','desktop.control']});
    }
    await vault.write('desktop-builtin-provisioned', true);
  }
  // Refresh an installed bundled engine after an application update; stage retains grants.
  // An explicitly uninstalled desktop package stays uninstalled.
  if(desktop.extraPackages.length&&packages.list().some(item=>item.id==='cagent.desktop'))await packages.install({id:'cagent.desktop',confirm:true});
  let listenerStartupError:string|undefined;
  if(await vault.read('connection-resume-listener',z.boolean())){
    const previous=server.status();
    if(previous.passwordConfigured&&previous.bind&&previous.port)try{await server.start({bind:previous.bind,port:previous.port,advertisedHost:previous.advertisedHost,advertisedPort:previous.advertisedPort});}catch{listenerStartupError='连接服务未启动，请检查本机地址和端口';}
  }
  const lanRegistration=await createLanRegistration({vault,status:()=>server.status(),version:agentVersion});
  const assistant=new CagentAssistant(vault,{shells,applications:owner=>applications.list(owner),execute:(input,signal,owner,output)=>{
    if(owner!=='local'){
      const status=server.status(),peer=status.peers.find(p=>p.fingerprint===owner);
      const shell=clientShellSchema.parse((input as {shell:unknown}).shell);
      if(!peer?.shells.includes(shell)||!status.allowedShells?.includes(shell))throw new Error('控制端未获此 Shell 授权');
    }
    return terminal.execute(input,signal,output);
  },automation:async(action,input,owner)=>{if(action==='list')return automation.list(owner);if(action==='create')return automation.create(input,owner);return automation.change({...z.record(z.string(),z.unknown()).parse(input),action},owner);},allowed:owner=>server.managementAllowed(owner),capabilityTools:()=>packages.tools(),capabilityInvoke:(input,signal,owner)=>packages.invoke(input,owner,signal)});
  await assistant.load();
  const account=new CagentCloud(directory,codec,vault,assistant);
  automation=new CagentAutomation(vault,assistant);await automation.load();
  await automation.emit('agent','started',crypto.randomUUID(),{startedAt:new Date().toISOString()});
  const coding=new CodingService(vault,directory,owner=>owner==='local'||(server.managementAllowed(owner)&&server.status().peers.some(p=>p.fingerprint===owner&&p.shells.some(s=>server.status().allowedShells?.includes(s)))));
  await coding.load();
  const ide=new IdeService(vault,directory,owner=>owner==='local'||server.managementAllowed(owner));await ide.load();
  const accountNetwork=new AccountNetwork(account,new ClientVault(join(directory,'account-network'),codec));accountNetwork.setUpdateGuard(()=>updateAdmissionClosed);await accountNetwork.load();terminal.networkEnvironment=()=>accountNetwork.environment();
  const browserNetwork=new AgentBrowserNetwork(owner=>owner==='local'||server.browserAllowed(owner),(host,port)=>accountNetwork.open(host,port));
  const hosting = new HostingService(join(directory, 'hosting'));
  await hosting.load();
  let relay = new AgentRelayService({ vault, identity: await vault.identity() });
  await relay.load();
  const reverseRelay = new AgentReverseRelayService({ vault });
  await reverseRelay.load();
  const resumeUpdateServices=async()=>{
    const resume=await vault.read('update-resume-services',z.object({relay:z.boolean(),reverse:z.boolean()}).strict().nullable());
    if(!resume)return;
    if(resume.relay)await relay.start();
    if(resume.reverse)await reverseRelay.start();
    await vault.write('update-resume-services',null);
  };
  if(!updateCommitToken)await resumeUpdateServices().catch(()=>{});
  const accountReverse=new AgentReverseRelayService({vault:new ClientVault(join(directory,'account-transport'),codec)});await accountReverse.load();let accountRelayStamp='';
  account.setUpdateGuard(()=>updateAdmissionClosed);account.setTransport({deviceId:()=>server.status().deviceId,enroll:async()=>{let state=server.status();if(!state.passwordConfigured){await server.setAccess({password:randomBytes(32).toString('hex'),shells:[...new Set((await shells()).map(s=>s.shell))],allowManage:true,allowHttp:true,allowHosting:true,allowRelay:true});state=server.status();}if(!state.running)await server.start({bind:'127.0.0.1',port:state.port??22443});const info=JSON.parse(server.connectionInfo('127.0.0.1'));return {deviceId:info.deviceId,name:info.name,certificate:info.certificate,accountPassword:await server.revealPassword()};},start:async relay=>{const stamp=JSON.stringify(relay);if(accountRelayStamp===stamp&&accountReverse.status().running)return;await accountReverse.configure({enabled:true,relay,localHost:'127.0.0.1',localPort:server.status().port});await accountReverse.start();accountRelayStamp=stamp;},stop:async()=>{await accountReverse.stop();}});await account.load();
  const wsl = new AgentWslService(vault);
  await wsl.load();
  const wslNetwork = new WslNetworkSettings();
  const auditSchema = z
    .array(z.object({ time: z.string(), action: z.string(), error: z.string().optional() }))
    .max(100);
  const managementAudit = (await vault.read('management-audit', auditSchema)) ?? [];
  const recordManagement = async (action: string, error?: unknown) => {
    managementAudit.push({
      time: new Date().toISOString(),
      action,
      ...(error
        ? { error: error instanceof Error ? error.message.slice(0, 500) : '管理操作失败' }
        : {}),
    });
    managementAudit.splice(0, Math.max(0, managementAudit.length - 100));
    await vault.write('management-audit', managementAudit);
  };
  let control: Awaited<ReturnType<typeof startAgentControl>> | undefined;
  let closed = false;
  let networkProbes = 0;
  let mutation = Promise.resolve<unknown>(undefined);
  const serialized = (action: () => Promise<unknown>) => {
    queuedMutations++;
    const current = mutation.then(action);
    mutation = current.finally(()=>queuedMutations--).catch(() => {});
    return current;
  };
  const updateActivity=()=>({
    operations:activeDispatches,mutations:queuedMutations,terminals:terminal.activity,
    classroomScripts:managedScripts.activity,assistant:assistant.activity,coding:coding.activity,ide:ide.activity,applications:applications.activity,
    uploads:files.activity,browser:browserNetwork.activity,visual:visual.activity,desktop:desktop.service.activity,
    capabilities:packages.activity,wsl:wsl.activity,hosting:hosting.list().filter(s=>s.running).length,
    relay:relay.status().activeConnections,reverseRelay:reverseRelay.status().activeConnections,
    // An external extension does not expose a provable idle contract yet.
    externalExtensions:wechat?1:0,
    account:account.activity,accountNetwork:accountNetwork.activity,accountRelay:accountReverse.status().activeConnections,
    peers:server.status().peers.reduce((sum,peer)=>sum+peer.connected,0),
  });
  const safeUpdate=new SafeAgentUpdate({available:()=>updater.status(),activity:updateActivity,
    prepare:()=>updater.prepareInstall(server.status().deviceId),admission:value=>{updateAdmissionClosed=value;},shutdown:async()=>{await vault.write('update-resume-services',{relay:relay.status().running,reverse:reverseRelay.status().running});await close();}});
  async function installRuntimeUpdate(params: unknown) {
    z.object({ confirm: z.literal(true) }).strict().parse(params);
    await updater.verify();
    setTimeout(()=>void safeUpdate.request(),250).unref();
    return { queued:true,installing:false,protocol:1,message:'更新已准备，将在当前任务结束并空闲后自动完成。' };
  }
  async function dispatch(
    method: string,params: unknown,signal = new AbortController().signal,local = true,owner = 'local',
  ): Promise<unknown> {
    if(closed)throw Error('Agent 已关闭');
    if(updateAdmissionClosed&&!['client.status','update.status','update.commit','agent.shutdown'].includes(method))throw Error('CAgent 正在完成更新，请稍后重试');
    const tracked=!['client.status','update.status','update.install','update.commit','update.check','update.download','update.settings','update.verify','agent.shutdown'].includes(method);
    if(tracked)activeDispatches++;
    try{return await dispatchOperation(method,params,signal,local,owner);}finally{if(tracked)activeDispatches--;}
  }
  async function dispatchOperation(
    method: string,
    params: unknown,
    signal = new AbortController().signal,
    local = true,
    owner = 'local',
  ): Promise<unknown> {
    signal.throwIfAborted();
    if (closed) throw new Error('Agent 已关闭');
    if(method.startsWith('account.')){if(!local)throw Error('账号操作仅允许本机执行');return account.call(method,params);}
    if(method.startsWith('update.')){
      if(!local)throw new Error('更新只允许在本机执行');
      if(method==='update.commit'){
        const input=z.object({token:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(params);
        if(!updateCommitToken||input.token!==updateCommitToken)throw Error('更新启动凭据不匹配');
        await resumeUpdateServices();
        updateCommitToken=undefined;updateAdmissionClosed=false;
        if(updateCommitDeadline)clearTimeout(updateCommitDeadline);
        safeUpdate.start();return{committed:true,deviceId:server.status().deviceId,agentVersion};
      }
      if(method==='update.settings')return updater.settings(z.object({automatic:z.boolean().optional()}).parse(params??{}).automatic);
      if(method==='update.check')return updater.check();
      if(method==='update.download')return updater.start();
      if(method==='update.status')return {...updater.status(),coordination:safeUpdate.status()};
      if(method==='update.verify')return updater.verify();
      if(method==='update.install')return installRuntimeUpdate(params);
      throw new Error('未知更新操作');
    }
    const admin=local || (owner!=='local' && server.managementAllowed(owner));
    if(method==='network.status')return accountNetwork.status();
    if(method==='network.configure')return accountNetwork.configure(params);
    if(method==='machine.snapshot'){if(!admin)throw Error('未授权远程管理');z.object({}).strict().parse(params??{});return machineSnapshot(signal);}
    if (method === 'network.probe') {
      if (!local && (owner === 'local' || !server.browserAllowed(owner))) throw new Error('未授权网络访问');
      if (networkProbes >= 2) throw new Error('已有网络检测正在进行，请稍后再试');
      networkProbes++;
      try { return await probeNetwork(params, signal); } finally { networkProbes--; }
    }
    if(method.startsWith('browser.')){if(!local&&owner==='local')throw Error('未授权');return browserNetwork.call(method,params,owner);}
    if(method.startsWith('ide.')){if(!admin)throw Error('未授权');return ide.call(method,params,owner);}
    if(method.startsWith('coding.')){if(!admin)throw Error('未授权');return ['coding.permission','coding.start','coding.configure','coding.profile.save','coding.profile.remove','coding.install'].includes(method)?serialized(()=>coding.call(method,params,owner)):coding.call(method,params,owner);}
    if(method.startsWith('visual.')){
      if(!admin)throw new Error('未授权远程管理');
      if(method==='visual.status')return visual.status(owner);
      if(method==='visual.launch')return visual.launch(owner,params);
      if(method==='visual.frame')return visual.frame(owner);
      if(method==='visual.input')return visual.input(owner,params);
      if(method==='visual.close')return visual.close(owner);
      throw new Error('未知可视化操作');
    }
    if(method.startsWith('files.')){if(!admin)throw new Error('未授权远程管理');return files.call(method,params,owner,signal);}
    if(method==='connection.autostart'){if(!admin)throw new Error('未授权远程管理');return setStartup(z.object({enabled:z.boolean()}).strict().parse(params).enabled);}
    if(method==='connection.settings') {
      if(!admin)throw new Error('未授权远程管理');
      const status=server.status();return {...status,listenerStartupError,autostart:await startupState(),password:await server.revealPassword(),interfaces:[...new Set(Object.values(networkInterfaces()).flatMap(v=>v?.filter(i=>!i.internal&&i.family==='IPv4').map(i=>i.address)??[]))]};
    }
    if(method==='connection.save') {
      if(!admin)throw new Error('未授权远程管理');
      const input=z.object({bind:z.string(),port:z.number().int().min(1024).max(65535),password:z.string().max(128).optional(),shells:z.array(clientShellSchema).min(1).max(6).optional(),allowManage:z.boolean().optional(),allowHttp:z.boolean().optional(),allowHosting:z.boolean().optional(),allowRelay:z.boolean().optional(),advertisedHost:z.string().optional(),advertisedPort:clientEndpointSchema.shape.port.optional()}).strict().parse(params);
      if(!['0.0.0.0', '127.0.0.1','::1',...Object.values(networkInterfaces()).flatMap(v=>v?.map(i=>i.address)??[])].includes(input.bind))throw new Error('请选择当前设备的网络地址');
      if(input.advertisedHost)clientEndpointSchema.shape.host.parse(input.advertisedHost); if(['0.0.0.0','::'].includes(input.advertisedHost??''))throw Error('连接地址不能是 0.0.0.0，请填写其他设备能够访问的 IP 或域名');const connectionPassword=input.password||await server.revealPassword();if(!connectionPassword)throw Error('首次开启连接请设置连接密码');
      const apply=async()=>{
        await server.stop();await server.setAccess({password:connectionPassword,shells:input.shells??(server.status().passwordConfigured?server.status().allowedShells:[...new Set([...(await shells()).map(s=>s.shell),...(process.platform==='win32'?['wsl' as const]:[])])]),allowManage:input.allowManage??(server.status().passwordConfigured?server.status().allowManage:true),allowHttp:input.allowHttp??(server.status().passwordConfigured?server.status().allowHttp:true),allowHosting:input.allowHosting??(server.status().passwordConfigured?server.status().allowHosting:true),allowRelay:input.allowRelay??(server.status().passwordConfigured?server.status().allowRelay:true)});
        const current=await desktop.dispatch('desktop.status',{},'local',true) as {config:Record<string,unknown>};
        if(desktop.extraPackages.length)await desktop.dispatch('desktop.configure',{...current.config,directListener:false,bindAddress:input.bind,tcpPort:input.port,udpPort:input.port,publicTcpPort:input.advertisedPort,publicUdpPort:input.advertisedPort??input.port},'local',true);
        await server.start({bind:input.bind,port:input.port,advertisedHost:input.advertisedHost,advertisedPort:input.advertisedPort});
        await vault.write('connection-resume-listener',true);listenerStartupError=undefined;
      };
      if(local){await serialized(apply);return {saved:true};}
      setTimeout(()=>void serialized(apply).catch(error=>recordManagement('connection.save.failed',error)),200).unref();return {changing:true,disconnects:true};
    }
    if(method.startsWith('desktop.')){
      if(!local&&(owner==='local'||!server.managementAllowed(owner)))throw new Error('未授权控制端管理远程桌面');
      if(server.status().deviceId!==desktopIdentity)throw new Error('设备身份已迁移，请重启 cagent 后使用远程桌面');
      return desktop.dispatch(method,params,owner,admin);
    }
    if(method.startsWith('managedWechat.')){
      if(!local)throw Error('微信服务配置需在受控端本机操作');
      const input=z.object({id:z.string(),settings:z.unknown().optional(),pid:z.number().int().positive().optional()}).strict().parse(params);
      const pack=managedWechat.find(p=>p.entry.id===input.id);if(!pack)throw Error('没有此已验证微信能力包');
      if(method==='managedWechat.status')return pack.status();
      if(!packages.list().some(p=>p.id===input.id))throw Error('请先安装此能力包');
      if(method==='managedWechat.processes')return pack.processes();
      if(method==='managedWechat.configure'){const result=await pack.configure(input.settings);await packages.refresh({id:input.id});return result;}
      if(method==='managedWechat.bind'){if(!input.pid)throw Error('请选择实际微信进程');const result=await pack.bind(input.pid);await packages.refresh({id:input.id});return result;}
      if(method==='managedWechat.validate'){if(!input.pid)throw Error('请选择实际微信进程');const result=await pack.validate(input.pid);await packages.refresh({id:input.id});return result;}
      throw Error('未知微信配置操作');
    }
    if(method.startsWith('wechat.')){
      if(!wechat)throw new Error('请先导入微信自定义扩展并重新启动 CAgent');
      if(!admin||(!local&&(owner==='local'||!server.managementAllowed(owner))))throw new Error('未授权管理此机器的微信');
      if(!packages.list().some(item=>item.id==='cagent.wechat'))throw new Error('请先在此机器安装微信掌控');
      if(method==='wechat.status')return wechat.service.status();
      if(method==='wechat.configure'){await wechat.verify();await wechat.service.save(params);await packages.refresh({id:'cagent.wechat'});return {saved:true};}
      if(method==='wechat.stop'){await wechat.service.subscriptions.stopAll();return {stopped:true};}
      throw new Error('未知微信管理操作');
    }
    if(method.startsWith('packages.')){
      if(!local&&(owner==='local'||!server.managementAllowed(owner)))throw new Error('未授权控制端管理能力包');
      if(method==='packages.catalog')return packages.catalog();
      if(method==='packages.list')return packages.list();
      if(method==='packages.tools')return packages.tools();
      if(method==='packages.invoke'){
        const controller=new AbortController();
        const guard=setInterval(()=>{if(!local&&!server.managementAllowed(owner))controller.abort(new Error('控制端授权已撤销'));},100);
        try{return await packages.invoke(params,owner,AbortSignal.any([signal,controller.signal]));}finally{clearInterval(guard);}
      }
      if(!admin)throw new Error('未授权管理能力包');
      if(method==='packages.install')return packages.install(params,signal);
      if(method==='packages.grant')return packages.grant(params);
      if(method==='packages.uninstall')return packages.uninstall(params);
      if(method==='packages.refresh')return packages.refresh(params);
      throw new Error('未知能力包操作');
    }
    if(method==='environment.read'||method==='environment.save'){if(!admin)throw Error('未授权环境配置');return method==='environment.read'?managedEnvironment.snapshot():serialized(()=>managedEnvironment.save(params));}
    if(method.startsWith('management.script.')){if(!admin)throw Error('未授权批量命令');if(method==='management.script.start')return managedScripts.start(owner,params);return managedScripts.query(owner,params,method==='management.script.cancel');}
    if(method.startsWith('automation.')){
      if(!local)throw Error('自动化管理需在受控端操作');
      if(method==='automation.list')return automation.list(owner);
      if(method==='automation.create')return automation.create(params,owner);
      if(method==='automation.change')return automation.change(params,owner);
      if(method==='automation.event'){const e=z.object({source:z.string(),type:z.string(),id:z.string(),payload:z.unknown()}).strict().parse(params);return automation.emit(e.source,e.type,e.id,e.payload);}
      throw Error('未知自动化操作');
    }
    if(method.startsWith('assistant.')){
      if(!local&&owner==='local')throw new Error('缺少控制端身份');
      if(method==='assistant.start')return assistant.start(params,owner);
      if(method==='assistant.tasks')return assistant.list(owner);
      if(method==='assistant.task')return structuredClone(assistant.get(params,owner));
      if(method==='assistant.cancel')return assistant.cancel(params,owner);
      if(!admin)throw new Error('未授权管理智能体配置');
      if(method==='assistant.settings')return assistant.snapshot();
      if(method==='assistant.model.configure')return serialized(()=>assistant.configureModel(params));
      if(method==='assistant.configure')return serialized(()=>assistant.configure(params));
      if(method==='assistant.approve')return assistant.approve(params);
      throw new Error('未知智能体操作');
    }
    if (!local && owner === 'local' && method.startsWith('applications.')) throw new Error('缺少控制端身份');
    if (method === 'applications.policy') { if(!admin)throw new Error('未授权管理应用安装');return applications.policySnapshot(); }
    if (method === 'applications.list') return applications.list(owner);
    if (method === 'applications.status') return applications.status(params, owner);
    if (method === 'applications.plan') return applications.plan(params, owner, signal);
    if (method === 'agent.shells' || method === 'agent.environments') return shells();
    if (method === 'client.status')
      return {
        ...server.status(),
        agentVersion,methods:[...agentMethods],updateProtocol:1,updatePendingCommit:!!updateCommitToken,activity:updateActivity(),
        canImportLegacy: local && canImportLegacy,
        platform: process.platform,
        interfaces: [
          ...new Set([
            '0.0.0.0', '127.0.0.1',
            '::1',
            ...Object.values(networkInterfaces()).flatMap((v) => v?.map((i) => i.address) ?? []),
          ]),
        ],
      };
    if (method === 'agent.logs')
      return [...server.status().audit, ...managementAudit].sort((a, b) =>
        b.time.localeCompare(a.time),
      );
    if (method === 'client.info')
      return server.connectionInfo(
        z
          .string()
          .max(253)
          .parse(
            typeof params === 'object' && params ? (params as { host?: string }).host : params,
          ),
      );
    if (method === 'hosting.list') return hosting.list();
    if (method === 'hosting.logs') return hosting.logs(idInput(params));
    if (method === 'relay.status') return relay.status();
    if (method === 'relay.revealCredential') return relay.revealCredential();
    if (method === 'relay.registrationCredential')
      return relay.registrationCredential(
        z
          .object({ targetId: z.string().min(1).max(100) })
          .strict()
          .parse(params),
      );
    if (method === 'relay.reverse.status') return reverseRelay.status();
    if (method === 'wsl.check') return wsl.check();
    if (method === 'wsl.status' || method === 'wsl.logs') return wsl.status();
    if (method === 'wsl.account.status') return wsl.accountStatus(params);
    if (method.startsWith('wsl.network.') && process.platform !== 'win32')
      throw new Error('WSL 网络仅适用于 Windows Agent');
    if (method === 'wsl.network.read') return wslNetwork.read();
    if (method === 'agent.shutdown') {
      if (!local) throw new Error('仅本机可退出 Agent');
      z.object({ confirm: z.literal(true) })
        .strict()
        .parse(params);
      setTimeout(() => void close(), 100).unref();
      return { stopping: true };
    }
    return serialized(async () => {
      signal.throwIfAborted();
      if (closed) throw new Error('Agent 已关闭');
      if (method === 'applications.configure') {
        if (!admin) throw new Error('未授权管理应用安装');
        const result = await applications.configure(params);
        await recordManagement('applications.configure');
        return result;
      }
      if (method === 'applications.cancel') return applications.cancel(params, owner);
      if (method === 'applications.install') {
        await recordManagement('applications.install');
        signal.throwIfAborted();
        return applications.install(params, owner);
      }
      if (method === 'client.access') {
        const result = await server.setAccess(params);
        canImportLegacy = false;
        return result;
      }
      if (method === 'client.start') {
        const result = await server.start(params);
        canImportLegacy = false;
        return result;
      }
      if (method === 'client.stop') {
        await vault.write('connection-resume-listener',false);
        if (local) return server.stop();
        setTimeout(() => {
          if (!closed)
            void serialized(() => {
              signal.throwIfAborted();
              return server.stop();
            }).catch((error) => recordManagement('service.stop.failed', error));
        }, 150);
        return { stopping: true, disconnects: true };
      }
      if (method === 'client.reconfigure') {
        const input = z
          .object({
            confirmDisconnect: z.literal(true),
            listener: z
              .object({
                bind: z.string(),
                port: clientEndpointSchema.shape.port,
                advertisedHost: clientEndpointSchema.shape.host.optional(),
                advertisedPort: clientEndpointSchema.shape.port.optional(),
              })
              .strict()
              .optional(),
            access: clientAccessSchema.optional(),
          })
          .strict()
          .parse(params);
        if (!input.listener && !input.access) throw new Error('未指定要修改的配置');
        if (
          input.listener &&
          ![
            '0.0.0.0', '127.0.0.1',
            '::1',
            ...Object.values(networkInterfaces()).flatMap(
              (rows) => rows?.map((row) => row.address) ?? [],
            ),
          ].includes(input.listener.bind)
        )
          throw new Error('请选择当前 Agent 的真实网络接口');
        const status = server.status();
        const listener =
          input.listener ??
          (status.running && status.bind && status.port
            ? { bind: status.bind, port: status.port, advertisedHost: status.advertisedHost, advertisedPort: status.advertisedPort }
            : undefined);
        await recordManagement('configuration.change.accepted');
        setTimeout(() => {
          if (closed) return;
          void serialized(async () => {
            signal.throwIfAborted();
            await server.stop();
            if (input.access) await server.setAccess(input.access);
            if (listener) await server.start(listener);
            canImportLegacy = false;
            await recordManagement('configuration.changed');
          }).catch((error) => recordManagement('configuration.change.failed', error));
        }, 150);
        return {
          changing: true,
          disconnects: true,
          repair: '可在目标设备的本机 Agent 控制面板或 CLI 恢复配置',
        };
      }
      if (method === 'client.revoke')
        return server.revoke(
          typeof params === 'object' && params
            ? (params as { fingerprint?: string }).fingerprint
            : params,
        );
      if (method === 'hosting.save')
        return hosting.save(
          z.object({ config: hostingConfigSchema }).strict().parse(params).config,
        );
      if (method === 'hosting.start') {
        const input = z
          .object({
            id: z.string().uuid(),
            expectedRevision: z.number().int().min(0),
            allowCode: z.boolean().optional(),
          })
          .strict()
          .parse(params);
        return hosting.start(input.id, {
          expectedRevision: input.expectedRevision,
          allowCode: input.allowCode,
        });
      }
      if (method === 'hosting.stop') return hosting.stop(idInput(params));
      if (method === 'hosting.remove') return hosting.remove(idInput(params));
      if (method === 'relay.configure')
        return relay.configure(params);
      if (method === 'relay.start') return relay.start();
      if (method === 'relay.stop') return relay.stop();
      if (method === 'relay.rotateCredential') return relay.rotateCredential();
      if (method === 'relay.rotateRegistrationCredential')
        return relay.rotateRegistrationCredential(
          z
            .object({ targetId: z.string().min(1).max(100) })
            .strict()
            .parse(params),
        );
      if (method === 'relay.reverse.configure') return reverseRelay.configure(params);
      if (method === 'relay.reverse.start') return reverseRelay.start();
      if (method === 'relay.reverse.stop') return reverseRelay.stop();
      if (method === 'wsl.plan') return wsl.plan(params);
      if (method === 'wsl.install') return wsl.install(params);
      if (method === 'wsl.cancel') return wsl.cancel();
      if (method === 'wsl.account.initialize') return wsl.initializeAccount(params);
      if (method === 'wsl.network.save') return wslNetwork.save(params);
      if (method === 'wsl.network.apply') {
        z.object({ confirmDisconnect: z.literal(true) })
          .strict()
          .parse(params);
        await wslNetwork.shutdown();
        return { applied: true, disconnects: true };
      }
      if (method === 'legacy.import') {
        if (
          !local ||
          !canImportLegacy ||
          server.status().running ||
          server.status().passwordConfigured ||
          server.status().peers.length ||
          relay.status().running ||
          hosting.list().some((s) => s.running)
        )
          throw new Error('只可在新 Agent 首次配置前导入旧身份');
        const input = legacySchema.parse(params),
          certificate = new X509Certificate(input.identity.certificate);
        if (
          certificate.publicKey.export({ type: 'spki', format: 'pem' }) !==
          createPublicKey(input.identity.key).export({ type: 'spki', format: 'pem' })
        )
          throw new Error('旧设备证书与私钥不匹配');
        // Encrypted journal finishes interrupted migrations before loading any network service.
        await desktop.shutdown();
        await vault.write('legacy-import-pending', input);
        await finishLegacyImport(vault, input);
        await server.load();
        await relay.stop();
        relay = new AgentRelayService({ vault, identity: input.identity });
        await relay.load();
        canImportLegacy = false;
        return { imported: true, deviceId: server.status().deviceId };
      }
      throw new Error('不支持的 Agent 管理操作');
    });
  }
  let updateCommitDeadline:ReturnType<typeof setTimeout>|undefined;
  async function close() {
    if (closed) return;
    closed = true;
    if(updateCommitDeadline)clearTimeout(updateCommitDeadline);
    safeUpdate.close();
    updater.close();
    const failures:unknown[]=[];
    // A failed optional service must not leave the authenticated control socket
    // or listener half alive when an update needs to restore the old runtime.
    for(const stop of [()=>lanRegistration.close(),()=>visual.dispose(),()=>files.close(),()=>accountNetwork.close(),()=>account.close(),()=>accountReverse.stop(),()=>browserNetwork.close(),()=>coding.close(),()=>ide.close(),
      ()=>managedScripts.close(),()=>automation.close(),()=>assistant.close(),()=>control?.close(),()=>mutation,()=>packages.dispose(),...managedWechat.map(pack=>()=>pack.shutdown()),()=>wechat?.shutdown(),()=>desktop.shutdown(),
      ()=>applications.dispose(),()=>wsl.dispose(),()=>hosting.dispose(),()=>reverseRelay.stop(),()=>relay.stop(),()=>server.stop(),
      ()=>terminal.dispose(),()=>vault.flush(),()=>options.onClose?.()])try{await stop();}catch(error){failures.push(error);}
    if(failures.length)throw new AggregateError(failures,'部分后台服务清理失败');
  }
  return {
    server,
    terminal,
    dispatch,
    async startControl() {
      if (control) throw new Error('本机控制服务已运行');
      control = await startAgentControl(directory, (m, p, s) => dispatch(m, p, s, true));
      // Shutdown may arrive while the discovery file is being protected.
      if (closed) { await control.close(); return; }
      await updater.initialize();
      if(!updateCommitToken)safeUpdate.start();
      else updateCommitDeadline=setTimeout(()=>void close().catch(()=>{}),60000);
    },
    close,
    directory,
  };
}
import { probeNetwork } from '../core/network-probe';

