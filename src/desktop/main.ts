import {provisionDesktop} from '../core/provisioning-desktop';
import {ClassroomShareService} from './classroom-share';
import {registerUsage} from './usage';
import {ftpTransfers} from './ftp-transfers';
import {FtpConnectionProvider,ftpIdentity} from '../core/connections/ftp-provider';
import {FtpService} from '../core/ftp';
import {profileProvider} from '../shared/file-connections';
import {registerCommandConsole} from './command-console';
import {runCli} from '../cli/main';
import {LinuxWorkspaceService} from '../core/linux-workspace';
import {registerConnectionImport} from './connection-import';
import {registerNetworkDiagnostics} from './network-diagnostics';
import {MachineBrowser} from './machine-browser';
import { visualToolSource } from '../core/visual-tools';
import { visualCapabilities } from '../shared/visual-tools';
import {localViewProfiles} from '../shared/monitor-views';
import { Diagnostics } from '../core/diagnostics';
import { openRdpProfile, rdpProfileSchema } from '../core/rdp';
import { installWindowPermissions } from './window-permissions';
import { HttpWorkspaces } from '../core/http-workspaces';
import { loadPrivateWechat } from '../core/custom-extensions';
import { testStartGate } from './test-start-gate';
import { registerAgent } from './agent';
import { syncClientProfiles } from '../core/client/profiles';
import { ConnectionAttempts } from '../core/connection-attempts';
import { wslAccountStatus, initializeWslAccount } from './wsl-account';
import { startClientApplication, clientCodec } from './client-app';
import { ClientProvider } from '../core/client/provider';
import { ClientVault } from '../core/client/identity';
import { ProcessExtensions } from '../core/process-extensions';
import { registerCloudHandlers } from './cloud-sync';
import { DesktopLooks } from '../core/desktop-looks';
import { DesktopAccountProfiles } from '../core/desktop-account-profiles';
import { clientShellSchema } from '../shared/client';
import { LocalTerminalProvider } from '../core/connections/local-terminal-provider';
import { WslSetup } from './wsl-setup';
import { WslNetworkSettings } from './wsl-network';
import { createSshManager } from '../core/connections/ssh-provider';
import type { ConnectionManager } from '../core/connections/manager';
import { ActivityStore } from '../core/activity';
import { registerActivity } from './activity';
import type { Activity } from '../shared/activity';
import { FloatingWindows, snapshotSchema } from './floating';
import { MonitorWindows } from './monitor-windows';
import { registerExtensionHandlers } from './extensions';
import { createExtensionServices } from '../core/api/extensions';
import { registerUpdateHandlers } from './updates';
import { initialWindowBounds } from './window-bounds';
import { registerAiHandlers } from './ai';
import { toolsSettingsSchema, dockerActionSchema, dockerId } from '../shared/docker';
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  safeStorage,
  session,
  screen,
  shell,
} from 'electron';
import { join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile, stat, realpath, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Store } from '../core/store';
import { SshService } from '../core/ssh';
import { Transfers } from '../core/transfers';
import {
  credentialsSchema,
  groupActionSchema,
  preferencesSchema,
  profileSchema,
  type SessionEvent,
} from '../shared/contracts';
import { remotePath } from '../core/paths';
import { McpService } from '../core/mcp';
import { registerPresetHandlers } from './presets';
import { registerAppearanceHandlers } from './appearance';
import { registerFileHandlers } from './file-handlers';
import { ResourceInspection } from '../core/resource-inspection';
import { isPro, productName } from '../shared/edition';

let window: BrowserWindow;
let ssh: SshService;
let transfers: Transfers;
const idSchema = z.string().uuid();
app.commandLine.appendSwitch('disable-quic');
const pathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((p) => !/[\0\r\n]/.test(p));
const clientMode = process.argv.includes('--client') || app.getName() === 'CShell Client';
if(isPro && !clientMode){app.setName(productName);app.setPath('userData',join(app.getPath('appData'),productName));app.setAppUserModelId('org.canpshell.pro');}
if (clientMode) app.setPath('userData', join(app.getPath('appData'), 'CShell Client'));
if (process.env.CSHELL_TEST_DATA) app.setPath('userData', process.env.CSHELL_TEST_DATA);
// Keep the single-instance lock at the installation's root, not at an account profile.
const provisioningIndex=process.argv.indexOf('--provision-file');
const cliIndex = process.argv.indexOf('--cli');
const hasLock = cliIndex < 0 && app.requestSingleInstanceLock();
const accountProfiles=cliIndex<0&&isPro&&!clientMode?new DesktopAccountProfiles(app.getPath('userData')):undefined;
if(accountProfiles)app.setPath('userData',accountProfiles.bootDirectory());
if(accountProfiles||process.env.CSHELL_TEST_DATA)app.setPath('sessionData',app.getPath('userData'));
let accountTransition=false;
const diagnostics = new Diagnostics(app.getPath('userData'), app.getVersion());
process.on('uncaughtExceptionMonitor', error => diagnostics.record('main.uncaught', error));
process.on('unhandledRejection', error => diagnostics.record('main.rejection', error));
app.on('child-process-gone', (_event, details) => diagnostics.record('process.' + details.type, `${details.reason} (${details.exitCode})`));
app.on('web-contents-created', (_event, contents) => {
  contents.on('render-process-gone', (_event, details) => diagnostics.record('renderer.gone', `${details.reason} (${details.exitCode})`));
  contents.on('preload-error', (_event, _path, error) => diagnostics.record('preload.error', error));
  contents.on('unresponsive', () => diagnostics.record('renderer.unresponsive', 'Window did not respond'));
});
ipcMain.on('diagnostics:error', (event, value) => {
  const entry = pathToFileURL(join(__dirname, '../renderer/index.html')).href;
  if (event.senderFrame !== event.sender.mainFrame || event.senderFrame?.url.split('?')[0] !== entry) return;
  if (!value || typeof value.message !== 'string' || value.message.length > 12000) return;
  const error = new Error(value.message);
  if (typeof value.stack === 'string') error.stack = value.stack.slice(0, 12000);
  diagnostics.record('renderer.error', error);
});
// A launcher may leave the first window hidden. Focusing alone cannot reveal it.
// Register before async initialization so a second launch is never missed.
const revealWindow = () => {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
};
if (hasLock) app.on('second-instance', revealWindow);
if (cliIndex >= 0) void runCli(process.argv.slice(cliIndex + 1)).then(code => app.exit(code));
else if (!hasLock) { if(provisioningIndex>=0)app.exit(2);else app.quit(); }
else
  app
    .whenReady()
    .then(async () => {
      await testStartGate;
      if(provisioningIndex>=0){
        try{const file=process.argv[provisioningIndex+1];if(!file||file.startsWith('--')||clientMode)throw Error();const result=await provisionDesktop(file,app.getPath('userData'),process.argv.includes('--apply'));console.log(JSON.stringify(result));if(process.argv.includes('--provision-only')||!process.argv.includes('--apply')){app.exit(0);return;}}
        catch{console.error('CShell 初始部署未完成，请检查配置文件、扩展包与数据目录；原数据保留。');app.exit(1);return;}
      }


      if (clientMode) return startClientApplication();
      const store = new Store(app.getPath('userData'), {
        encrypt: async (value) => {
          if (
            !safeStorage.isEncryptionAvailable() ||
            (process.platform === 'linux' &&
              safeStorage.getSelectedStorageBackend() === 'basic_text')
          )
            throw new Error('Secure credential storage unavailable');
          return (await safeStorage.encryptStringAsync(value)).toString('base64');
        },
        decrypt: async (value) =>
          (await safeStorage.decryptStringAsync(Buffer.from(value, 'base64'))).result,
      });
      await store.load();
      const activity = new ActivityStore(app.getPath('userData'));
      await activity.load();
      const recordedTransfers = new Set<string>();
      const zh = () => store.snapshot().preferences.locale === 'zh-CN';
      const text = (cn: string, en: string) => (zh() ? cn : en);
      const entry = pathToFileURL(join(__dirname, '../renderer/index.html')).href;
      const titleBarColors = (theme: 'dark' | 'light') => ({
        color: theme === 'dark' ? '#171f28' : '#f5f7fa',
        symbolColor: theme === 'dark' ? '#dce5ee' : '#233248',
        height: 40,
      });
      window = new BrowserWindow({
        ...initialWindowBounds(
          screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea,
        ),
        title: productName + ' · CanpShell',
        icon: join(app.getAppPath(), isPro ? 'assets/brand/cshell-pro.png' : 'assets/icon.png'),
        backgroundColor: store.snapshot().preferences.theme === 'light' ? '#ffffff' : '#171f28',
        show: false,
        titleBarStyle: 'hidden',
        titleBarOverlay: titleBarColors(store.snapshot().preferences.theme),
        webPreferences: {
          preload: join(__dirname, 'preload.cjs'),
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          spellcheck: false,
          backgroundThrottling: false,
        },
      });
      window.once('ready-to-show', revealWindow);
      window.webContents.once('did-finish-load', revealWindow);
      Menu.setApplicationMenu(null);
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (event) => event.preventDefault());
      window.webContents.on('will-attach-webview', (event) => event.preventDefault());
      installWindowPermissions(session.defaultSession, window.webContents, entry);
      let connections: ConnectionManager | undefined;
      let floating: FloatingWindows | undefined;
      const monitorWindows = new MonitorWindows(store, entry, join(__dirname, 'preload.cjs'),
        (id, sequence) => floating?.tail(id, sequence) ?? []);
      const viewHandlers = new Map<string, (...args: any[]) => any>();
      let mcp: McpService | undefined;
      const emit = (event: SessionEvent) => {
        if (event.type === 'closed' && event.error) diagnostics.record('session.closed', event.error);
        if (event.type === 'transfer' && event.transfer.state === 'failed') diagnostics.record('transfer.failed', 'Transfer failed');
        if (event.type === 'closed') connections?.closed(event.sessionId);
        if (mcp?.event(event)) return;
        if (
          event.type === 'transfer' &&
          event.transfer.state !== 'running' &&
          !recordedTransfers.has(event.transfer.id)
        ) {
          const transfer = event.transfer;
          recordedTransfers.add(transfer.id);
          if (recordedTransfers.size > 2000)
            recordedTransfers.delete(recordedTransfers.values().next().value!);
          activity.record({
            kind: 'transfer',
            action: transfer.direction,
            status:
              transfer.state === 'done'
                ? 'success'
                : transfer.state === 'cancelled'
                  ? 'cancelled'
                  : 'failed',
            provider: transfer.sessionId === 'local' ? 'cshell.local' : 'cshell.ssh',
            bytes: transfer.done,
          });
        }
        event = floating?.event(event) ?? event;
        if (!window.isDestroyed()) window.webContents.send('session:event', event);
        monitorWindows.publish('session:event', event);
      };
      ssh = new SshService(emit, async (profile, fingerprint, signal) => {
        signal.throwIfAborted();
        const endpoint = `${profile.host.toLowerCase()}:${profile.port}`,
          known = store.host(endpoint);
        if (known === fingerprint) return true;
        if (known) {
          await dialog.showMessageBox(window, {
            signal,
            type: 'error',
            title: text('主机密钥已改变', 'Host key changed'),
            message: text(
              '已阻止连接。请通过可信渠道核实服务器身份。',
              'Connection blocked. Verify server identity through a trusted channel.',
            ),
            detail: `${endpoint}\n${text('已保存', 'Saved')}: ${known}\n${text('当前', 'Received')}: ${fingerprint}`,
          });
          return false;
        }
        const result = await dialog.showMessageBox(window, {
          signal,
          type: 'warning',
          title: text('验证服务器身份', 'Verify server identity'),
          message: text(
            '首次连接此服务器。请核对 SHA256 指纹后再信任。',
            'First connection. Verify this SHA256 fingerprint before trusting the server.',
          ),
          detail: `${profile.username}@${endpoint}\n${fingerprint}`,
          buttons: [text('取消', 'Cancel'), text('信任并连接', 'Trust and connect')],
          defaultId: 0,
          cancelId: 0,
        });
        if (result.response !== 1 || signal.aborted) return false;
        await store.trust(endpoint, fingerprint);
        return true;
      });
      const classroom = new ClassroomShareService();
      const processExtensions = new ProcessExtensions({ directory: join(app.getPath('userData'), 'process-extensions'), vault: new ClientVault(join(app.getPath('userData'), 'process-extensions'), clientCodec), version: app.getVersion(), plugins: () => store.plugins(), changed: () => extensionServices.refreshProcessTools() });
      const extensionServices = createExtensionServices(ssh, store, async id => { if (id === 'cshell.http') http.dispose(); if(id === 'cshell.classroom') await classroom.dispose(); }, processExtensions);
      await processExtensions.refresh();
      window.once('closed', () => { void processExtensions.dispose(); });
      const ftp = new FtpService(emit);
      connections = createSshManager(ssh, () => store.snapshot().profiles, extensionServices.tools, target => {
        if(target.providerId!=='cshell.ftp')return;
        const profile=store.snapshot().profiles.find(p=>p.id===target.resourceId);
        if(!profile||!['ftp','ftps'].includes(profile.protocol??'')||ftpIdentity(profile as typeof profile & {protocol:'ftp'|'ftps'})!==target.identity)return;
        return {id:profile.id,group:profile.group};
      });
      connections.register(new FtpConnectionProvider(ftp));

      const attempts = new ConnectionAttempts((id) => connections!.disconnect(id));
      window.webContents.on('render-process-gone', () => attempts.dispose());
      window.webContents.on('did-start-loading', () => attempts.dispose());
      const localTerminal = new LocalTerminalProvider(app.getPath('userData'), store, emit);
      await localTerminal.load();
      const apiLocalShells = async () => process.platform !== 'win32' ? [] : [
        'cmd', 'powershell',
        ...(store.snapshot().plugins.some(p => p.enabled && p.manifest.id === 'cshell.wsl')
          ? (await localTerminal.distributions()).distributions.map(name => `wsl:${name}`) : []),
      ];
      connections.register(localTerminal);
      const clientProvider = new ClientProvider(
        new ClientVault(join(app.getPath('userData'), 'client-controller'), clientCodec),
        emit,
      );
      await clientProvider.load();
      await syncClientProfiles(store, clientProvider.list());
      connections.register(clientProvider);
      floating = new FloatingWindows(
        window,
        {
          input: (id, data) => connections!.tools.terminal(id).input(data),
          resize: (id, cols, rows) => connections!.tools.terminal(id).resize(cols, rows),
          get: (id) => ({ profile: { name: connections!.tools.describe(id).label } }),
        },
        entry,
        join(__dirname, 'preload.cjs'),
        () => store.snapshot().preferences,
      );
      transfers = new Transfers(
        ssh,
        (transfer) => emit({ type: 'transfer', transfer }),
        async (path) =>
          (
            await dialog.showMessageBox(window, {
              type: 'warning',
              message: text('目标文件已存在，是否覆盖？', 'Replace existing file?'),
              detail: path,
              buttons: [text('取消', 'Cancel'), text('覆盖', 'Replace')],
              defaultId: 0,
              cancelId: 0,
            })
          ).response === 1,
      );
      const ftpFiles=ftpTransfers(ftp,transfers);
      const grants = new Map<string, { path: string; expires: number }>();
      const grant = (path: string) => {
        for (const [key, value] of grants) if (value.expires < Date.now()) grants.delete(key);
        const token = randomUUID();
        grants.set(token, { path, expires: Date.now() + 300000 });
        return token;
      };
      const consume = (token: string) => {
        const value = grants.get(idSchema.parse(token));
        grants.delete(token);
        if (!value || value.expires < Date.now()) throw new Error('File access expired');
        return value.path;
      };
      const validateSender = (event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) => {
        if (
          !monitorWindows.accepts(event) && (event.sender !== window.webContents ||
          event.senderFrame !== window.webContents.mainFrame ||
          event.senderFrame.url !== entry)
        )
          throw new Error('Untrusted IPC sender');
      };
      const handle = (name: string, fn: (...args: any[]) => any) => {
        viewHandlers.set(name, fn);
        ipcMain.handle(name, async (event, ...args) => {
          validateSender(event);
          if(accountTransition&&name!=='cloud:status')throw Error('正在打开账号工作区，请稍候');
          const viewSender = monitorWindows.accepts(event);
          if (viewSender) monitorWindows.authorize(event, name, args);
          if (viewSender && monitorWindows.skip(event, name, args)) return;
          const types: Record<string, Activity['kind']> = {
            connect: 'connection',
            'connect:temporary': 'connection',
            'file:action': 'file',
            'local:action': 'file',
            'file:transfer': 'file',
            'ai:send': 'ai',
            'ai:extract-connection': 'ai',
            'docker:action': 'tool',
            'applications:install': 'deployment',
          };
          const kind = types[name],
            provider =
              name.startsWith('local:') ||
              (name === 'file:transfer' &&
                args[1]?.kind === 'local' &&
                Array.isArray(args[0]) &&
                args[0].every((s: { kind?: string }) => s?.kind === 'local'))
                ? 'cshell.local'
                : kind === 'ai'
                  ? 'ai'
                  : 'cshell.ssh',
            start = Date.now();
          try {
            const result = await fn(...args);
            if (viewSender) monitorWindows.track(event.sender.id, name, args, result,
              async (method, id) => viewHandlers.get(method)!(id));
            if (kind)
              activity.record({
                kind,
                action: name,
                status: 'success',
                provider,
                duration: Date.now() - start,
                ...(kind === 'connection'
                  ? {
                      resource:
                        name === 'connect' ? String(args[0]) : String(args[0]?.id || 'temporary'),
                    }
                  : {}),
              });
            return viewSender ? monitorWindows.result(event.sender.id, name, result) : result;
          } catch (error) {
            diagnostics.record('ipc.' + name, error);
            if (viewSender) monitorWindows.failed(event.sender.id, name);
            if (kind)
              activity.record({
                kind,
                action: name,
                status: 'failed',
                provider,
                duration: Date.now() - start,
              });
            throw error;
          }
        });
      };
      handle('diagnostics:open', async () => {
        diagnostics.record('diagnostics.open', 'Opened local diagnostic directory');
        const error = await shell.openPath(diagnostics.directory);
        if (error) throw new Error(error);
      });
      handle('views:list', () => store.monitorViews());
      handle('views:save', value => store.saveMonitorView(value));
      handle('views:delete', id => store.deleteMonitorView(idSchema.parse(id)));
      handle('views:displays', () => monitorWindows.displays());
      handle('views:open', id => monitorWindows.open(id));
      handle('views:current', (raw, rawMode) => {
        const mode = z.enum(['tile', 'focus', 'overview']).parse(rawMode);
        const sources = z.array(z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('ssh'), sessionId: idSchema, snapshot: snapshotSchema }).strict(),
          z.object({ kind: z.literal('terminal'), sessionId: idSchema, snapshot: snapshotSchema }).strict(),
          z.object({ kind: z.literal('desktop'), profileId: idSchema }).strict(),
        ])).min(1).max(96).parse(raw);
        if (sources.reduce((n, source) => n + (source.kind !== 'desktop' ? source.snapshot.data.length : 0), 0) > 32_000_000)
          throw new Error('当前终端历史过大，请减少本次展示的区域');
        return monitorWindows.current(sources.map(source => {
          if(source.kind === 'desktop')return {profile:store.profile(source.profileId)};
          const target=connections!.tools.describe(source.sessionId);connections!.tools.terminal(source.sessionId);
          let profile;try{profile=ssh.get(source.sessionId).profile}catch{profile=store.snapshot().profiles.find(p=>p.id===target.resourceId)??localViewProfiles.find(p=>p.name===target.label)??{id:source.sessionId,name:target.label,host:'localhost',port:1,username:'local',group:'',favorite:false,auth:'password' as const};}
          return {profile,shell:/\bcmd$/i.test(target.label)?'cmd' as const:/\bsh$/i.test(target.label)?'sh' as const:'powershell' as const,terminal:{sessionId:source.sessionId,snapshot:source.snapshot}};
        }), mode);
      });
      handle('views:close', id => monitorWindows.close(idSchema.parse(id)));
      handle('client:download-page', (raw?: unknown) => {
        const platform = z.enum(['windows']).optional().parse(raw);
        return shell.openExternal('https://shell.canp.ai/downloads.html?product=cagent' + (platform ? '&system=windows' : ''));
      });
      handle('client:probe', (endpoint) => clientProvider.probe(endpoint));
      handle('client:password-pair', async (info, password) => {
        const device = await clientProvider.pairPassword(info, password);
        await syncClientProfiles(store, [device]);
        return device;
      });
      handle('connection:rdp-save', async (value,password,clearPassword) => {
        const profile=rdpProfileSchema.parse(value);
        const old=store.snapshot().profiles.find(p=>p.id===profile.id);
        if(old&&old.protocol!=='rdp')throw new Error('Cannot change connection protocol');
        const secret=z.string().max(16000).optional().parse(password);
        const clear=z.boolean().optional().parse(clearPassword);
        // Discard any previous DPAPI credential file, including cleared or changed credentials.
        await rm(join(app.getPath('userData'),'rdp',profile.id+'.rdp'),{force:true});
        await store.saveProfile(profile);
        if(clear)await store.setSecret(profile.id,null);
        else if(secret!==undefined)await store.setSecret(profile.id,{password:secret});
      });
      handle('connection:rdp', async (value) => {
        const profile=rdpProfileSchema.parse(store.profile(idSchema.parse(value)));
        const secret=await store.secret(profile.id);
        await openRdpProfile(profile,secret?.password,join(app.getPath('userData'),'rdp'));
      });
      handle('client:devices', () => clientProvider.list());
      handle('client:pair', async (text) => {
        const device = await clientProvider.pair(z.string().max(16384).parse(text));
        await syncClientProfiles(store, [device]);
        return device;
      });
      handle('client:forget', (id) => clientProvider.forget(idSchema.parse(id)));
      handle('client:connect', async (id, shell, distribution) => {
        const sessionId = await connections!.connect(
          clientProvider.id,
          { deviceId: idSchema.parse(id), shell: clientShellSchema.parse(shell), distribution: z.string().min(1).max(100).optional().parse(distribution) },
          undefined,
        );
        return { sessionId, name: clientProvider.resolve(sessionId).target.label };
      });
      const desktopLooks=new DesktopLooks(app.getPath('userData'),store,()=>{if(!window.isDestroyed())window.webContents.send('desktop-look:changed');});
      await desktopLooks.load();
      handle('desktop-look:get',(id,legacy)=>desktopLooks.get(id,legacy));
      handle('desktop-look:save',(id,value)=>desktopLooks.save(id,value));
      registerAppearanceHandlers(handle, window, app.getPath('userData'), consume, text);
      registerUpdateHandlers(handle, window);
      registerUsage(handle, window);
      const classroomEnabled=()=>store.plugins().some(p=>p.manifest.id==='cshell.classroom'&&p.enabled);
      const requireClassroom=()=>{if(!classroomEnabled())throw Error('请先启用机房屏幕共享扩展');};
      handle('classroom:status',()=>{requireClassroom();return classroom.status();});
      handle('classroom:screens',()=>{requireClassroom();return classroom.screens();});
      handle('classroom:frame',(id)=>{requireClassroom();return classroom.frame(z.string().regex(/^[a-f0-9]{32}$/).parse(id));});
      handle('classroom:discover',(enabled)=>{requireClassroom();return classroom.setDiscovery(z.boolean().parse(enabled));});
      handle('classroom:stop',()=>classroom.stop());
      handle('classroom:start',async input=>{requireClassroom();const result=await classroom.start(z.object({screenId:z.string().min(1).max(120),label:z.string().trim().min(1).max(60)}).strict().parse(input));if(!classroomEnabled()){await classroom.dispose();throw Error('扩展已关闭');}return result;});
      let classroomWasEnabled=false, classroomChecking=false;
      const updateClassroom=async()=>{if(classroomChecking)return;const enabled=classroomEnabled();if(enabled===classroomWasEnabled)return;classroomWasEnabled=enabled;classroomChecking=true;try{if(enabled&&process.platform==='win32')await classroom.setDiscovery(true);else await classroom.dispose();}catch{}finally{classroomChecking=false;}};
      void updateClassroom();const classroomTimer=setInterval(()=>void updateClassroom(),1000);classroomTimer.unref();
      window.once('closed',()=>{clearInterval(classroomTimer);void classroom.dispose();});
      window.webContents.on('render-process-gone',()=>{void classroom.stop();});


      registerActivity(handle, window, activity);
      let normalBounds: Electron.Rectangle | null = null;
      let wasMaximized = false;
      let minimalHover = false;
      const hoverTimer = setInterval(() => {
        if (!normalBounds || window.isDestroyed()) return;
        const cursor = screen.getCursorScreenPoint(),
          bounds = window.getBounds();
        const hovered =
          !window.isMinimized() &&
          cursor.x >= bounds.x &&
          cursor.x < bounds.x + bounds.width &&
          cursor.y >= bounds.y &&
          cursor.y < bounds.y + 44;
        if (hovered !== minimalHover) {
          minimalHover = hovered;
          window.webContents.send('window:minimal-hover', hovered);
        }
      }, 100);
      window.once('closed', () => clearInterval(hoverTimer));
      handle('window:minimal', (input) => {
        const enabled = z.boolean().parse(input);
        if (enabled && !normalBounds) {
          normalBounds = window.getNormalBounds();
          wasMaximized = window.isMaximized();
          if (wasMaximized) window.unmaximize();
          const area = screen.getDisplayMatching(window.getBounds()).workArea;
          window.setMinimumSize(320, 200);
          window.setBounds({
            x: Math.max(area.x, Math.min(area.x + area.width - 560, normalBounds.x)),
            y: Math.max(area.y, Math.min(area.y + area.height - 360, normalBounds.y)),
            width: Math.min(560, area.width),
            height: Math.min(360, area.height),
          });
        } else if (!enabled && normalBounds) {
          const area = screen.getDisplayMatching(normalBounds).workArea;
          const width = Math.min(normalBounds.width, area.width),
            height = Math.min(normalBounds.height, area.height);
          window.setMinimumSize(Math.min(840, area.width), Math.min(580, area.height));
          window.setBounds({
            width,
            height,
            x: Math.max(area.x, Math.min(area.x + area.width - width, normalBounds.x)),
            y: Math.max(area.y, Math.min(area.y + area.height - height, normalBounds.y)),
          });
          if (wasMaximized) window.maximize();
          normalBounds = null;
        }
      });
      handle('window:always-on-top', (enabled) => {
        window.setAlwaysOnTop(z.boolean().parse(enabled));
        return window.isAlwaysOnTop();
      });
      const http = new HttpWorkspaces(app.getPath('userData'), store, connections.tools);
      const privateWechat = await loadPrivateWechat();
      const wechat = privateWechat ? new privateWechat.module.WechatService(app.getPath('userData'), store, {python:join(privateWechat.runtime,'python.exe'),local:true}) : undefined;
      await wechat?.load();
      handle('wechat:status', () => {if(!wechat)throw new Error('请导入微信自定义扩展并重新打开 CShell');return wechat.status();});
      handle('wechat:save', config => {if(!wechat)throw new Error('请导入微信自定义扩展并重新打开 CShell');return wechat.save(config);});
      handle('wechat:stop-subscriptions', () => wechat?.subscriptions.stopAll());
      if(wechat) wechat.subscriptions.onEvent = notification => { if (!window.isDestroyed()) window.webContents.send('wechat:event',notification); };
      await http.load();
      http.onChanged = id => { if (!window.isDestroyed()) window.webContents.send('http:changed', id); };
      handle('http:create', (name, group) => http.create(name, group));
      handle('http:workspace', id => http.workspace(id));
      handle('http:save', value => http.save(value));
      handle('http:senders', () => http.senders());
      handle('http:send', (id, request, runId) => http.send(id, request, runId, 'user'));
      handle('http:history', id => http.histories(id));
      handle('http:cancel', id => http.cancel(id));
      const linuxWorkspace=new LinuxWorkspaceService(ssh,join(app.getAppPath(),'dist/agent/agent.cjs'));
      const machineBrowser=new MachineBrowser(window,ssh);
      handle('machine-browser:action',(id,action,value)=>machineBrowser.action(id,action,value));
      handle('linux:plan',(id,directory)=>linuxWorkspace.plan(idSchema.parse(id),directory));
      handle('linux:install',(id,plan)=>linuxWorkspace.install(idSchema.parse(id),idSchema.parse(plan)));
      handle('linux:job',(id,job,cancel)=>linuxWorkspace.job(idSchema.parse(id),idSchema.parse(job),cancel===true));
      const agent = await registerAgent(handle, store, clientProvider, connections.tools, event => {
        if (event.type === 'error') diagnostics.record('desktop.error', event.message);
        if (event.type === 'closed' && event.reason) diagnostics.record('desktop.closed', event.reason);
        if (event.type === 'state' && event.reason) diagnostics.record('desktop.' + event.state, event.reason);
        if (!window.isDestroyed()) window.webContents.send('desktop:view-event', event);
        monitorWindows.publish('desktop:view-event', event);
      }, linuxWorkspace);
      machineBrowser.setAgentTransport(agent.browserTarget);
      connections.tools.registerToolSource('cshell.visual',visualCapabilities,visualToolSource({
        browser:(id,action,input,signal,guard)=>machineBrowser.automation(connections.tools.describe(id).providerId==='cshell.client'?'agent-session:'+id:id,action,input,signal,guard),
        desktop:(id,action,input,signal,guard)=>agent.desktopTool(id,action,input,signal,guard),
      }));
      const disposeAi = await registerAiHandlers(
        handle,
        app.getPath('userData'),
        store,
        connections.tools,
        async (profile, signal, authorize) => {
          if (profile.protocol === 'client') {
            if (!authorize()) throw new Error('Agent scope denied');
            const sessionId = await connections!.connect('cshell.client', { deviceId: profile.id, shell: profile.clientShell ?? 'powershell', distribution:profile.clientDistribution }, undefined, signal);
            if (signal.aborted || !authorize() || window.isDestroyed()) { await connections!.disconnect(sessionId); throw new Error('Agent connection cancelled'); }
            window.webContents.send('ai:connected', { sessionId, profile }); return sessionId;
          }
          const secret = await store.secret(profile.id);
          if (
            !secret ||
            (profile.auth === 'key' ? !secret.privateKey : secret.password === undefined)
          )
            throw new Error(
              '这台机器未保存连接凭据。请在工作区连接并保存凭据后重试；不要在聊天中发送密码。',
            );
          signal.throwIfAborted();
          if (!authorize()) throw new Error('Machine connection permission revoked');
          const sessionId = await connections!.connect(profileProvider(profile), profile, secret, signal);
          if (signal.aborted || !authorize() || window.isDestroyed()) {
            await connections!.disconnect(sessionId);
            throw new Error('Connection cancelled or permission revoked');
          }
          window.webContents.send('ai:connected', { sessionId, profile });
          return sessionId;
        },
        (channel, value) => {
          if (!window.isDestroyed()) window.webContents.send(channel, value);
          monitorWindows.publish(channel, value);
        },
        http,
        wechat,
        (ai, openCode, network, tavily) => registerCloudHandlers(handle, store, ai, clientProvider, http, () => {
          if (!window.isDestroyed()) {
            window.webContents.send('cloud:changed');
            window.webContents.send('ai:providers-changed');
          }
        }, machineBrowser, openCode, accountProfiles?{
          profiles:accountProfiles,
          assertIdle:()=>{if(ssh.size||ftp.size||localTerminal.size||clientProvider.size||transfers.size||http.running)throw Error('请先关闭连接并等待传输结束，再切换账号');},
          block:(value:boolean)=>{accountTransition=value;},
        }:undefined, network, tavily, desktopLooks),
        () => processExtensions.applicationTools(),
      );
      registerPresetHandlers(handle, window, app.getPath('userData'), store, text);
      registerConnectionImport(handle, window, store);
      const stopDiagnostics = registerNetworkDiagnostics(handle, store, ssh, clientProvider, connections.tools);
      window.once('closed', stopDiagnostics);
      window.once('closed', () => {
        void disposeAi().catch((error) => console.error('AI shutdown failed', error));
      });
      mcp = new McpService(
        store,
        app.getPath('userData'),
        async (name, command, signal) => {
          const result = await dialog.showMessageBox(window, {
            signal,
            type: 'warning',
            title: text('MCP 请求执行命令', 'MCP command request'),
            message: name,
            detail: command,
            buttons: [text('拒绝', 'Reject'), text('执行', 'Execute')],
            defaultId: 0,
            cancelId: 0,
          });
          return result.response === 1;
        },
        {
          manager: connections,
          http,
          applicationTools: extensionServices.applicationTools,
          connectEnvironment: async (parent, conda, prefix, signal, ready) => {
            let child: string | undefined;
            try {
              const result = await extensionServices.environments.openTerminal(parent, conda, prefix, signal, id => {
                child = id;
                connections!.adopt('cshell.ssh', id);
                ready(id);
              });
              return result.sessionId;
            } catch (error) {
              if (child) await connections!.disconnect(child);
              throw error;
            }
          },
          localShells: apiLocalShells,
          connectLocal: (shell, signal, ready) => connections!.connect('cshell.local-terminal', shell, undefined, signal, ready),
          connect: async (profile, signal, ready) => {
            if (profile.protocol === 'client')
              return connections!.connect(
                'cshell.client',
                {
                  deviceId: profile.id,
                  shell: profile.clientShell ?? 'powershell',
                  distribution: profile.clientDistribution,
                },
                undefined,
                signal,
                ready,
              );
            if ((!profile.protocol || ['ssh','sftp'].includes(profile.protocol)) && !store.host(`${profile.host.toLowerCase()}:${profile.port}`))
              throw new Error('Verify this SSH host identity in CShell before API access.');
            const secret = await store.secret(profile.id);
            if (!secret) throw new Error('Save credentials in CShell before API access.');
            signal.throwIfAborted();
            return connections!.connect(profileProvider(profile), profile, secret, signal, ready);
          },
        },
      );
      let mcpWrites = Promise.resolve();
      const serialMcp = <T>(fn: () => Promise<T>) => {
        const result = mcpWrites.catch(() => {}).then(fn);
        mcpWrites = result.then(() => {});
        return result;
      };
      handle('mcp:status', () => mcp!.status());
      handle('mcp:choose-file-root', async () => {
        const selected = await dialog.showOpenDialog(window, { properties: ['openDirectory'] });
        if (selected.canceled || !selected.filePaths[0]) return null;
        const path = await realpath(selected.filePaths[0]);
        const info = await stat(path);
        if (!info.isDirectory()) throw new Error('Select a directory');
        return { id: randomUUID(), path, name: basename(path) || path, identity: `${info.dev}:${info.ino}` };
      });
      handle('local-terminal:api-shells', apiLocalShells);
      handle('mcp:configure', (settings, expectedRevision) => {
        if (typeof expectedRevision !== 'string' || !/^[a-f0-9]{64}$/.test(expectedRevision))
          throw new Error('Reload API settings before saving.');
        return serialMcp(() => mcp!.configure(settings, expectedRevision));
      });
      handle('mcp:copy-token', async (clientId) =>
        clipboard.writeText(await mcp!.accessToken(clientId)),
      );
      handle('mcp:rotate-token', (clientId) => serialMcp(() => mcp!.rotateToken(clientId)));
      const disposeCommandConsole = registerCommandConsole(handle, () => mcp!);
      app.once('before-quit', disposeCommandConsole);
      await mcp.start();
      registerExtensionHandlers(handle, window, store, ssh, connections, async id => {
        if (id === 'cshell.http') http.dispose(); if(id === 'cshell.classroom') await classroom.dispose();
      }, extensionServices);
      const docker = extensionServices.docker;
      const requireDocker = (id: unknown) => {
        if (!store.snapshot().tools.dockerEnabled)
          throw new Error(text('Docker 面板未启用', 'Docker is disabled'));
        const session = idSchema.parse(id);
        ssh.get(session);
        return session;
      };
      handle('tools:configure', (settings) => store.setTools(toolsSettingsSchema.parse(settings)));
      handle('docker:snapshot', (id) => docker.snapshot(requireDocker(id)));
      handle('docker:stats', (id, container) =>
        docker.stats(requireDocker(id), dockerId.parse(container)),
      );
      handle('docker:details', (id, container) =>
        docker.details(requireDocker(id), dockerId.parse(container)),
      );
      handle('docker:action', async (id, input) => {
        const sessionId = requireDocker(id),
          action = dockerActionSchema.parse(input);
        if (['remove', 'removeImage', 'ports'].includes(action.type)) {
          const rebuilding = action.type === 'ports';
          const result = await dialog.showMessageBox(window, {
            type: 'warning',
            title: text(
              rebuilding ? '应用端口并重建' : '删除 Docker 资源',
              rebuilding ? 'Apply ports & recreate' : 'Delete Docker resource',
            ),
            message: text(
              rebuilding ? '重建将短暂停止容器。' : '确认删除此资源？',
              rebuilding ? 'Recreation will briefly stop this container.' : 'Delete this resource?',
            ),
            detail:
              ('id' in action ? action.id : '') +
              '\n' +
              text(
                rebuilding
                  ? '当前文件层会保存为本地镜像，旧容器保留为已停止的备份。挂载卷保持不变。'
                  : '不会强制删除运行中的容器，也不会删除挂载卷。',
                rebuilding
                  ? 'The writable layer is saved as a local image. The old container is kept stopped as a backup. Volumes are retained.'
                  : 'Running containers are not force-deleted. Volumes are retained.',
              ),
            buttons: [
              text('取消', 'Cancel'),
              text(rebuilding ? '重建' : '删除', rebuilding ? 'Recreate' : 'Delete'),
            ],
            defaultId: 0,
            cancelId: 0,
          });
          if (result.response !== 1) return {};
        }
        requireDocker(sessionId);
        return docker.action(sessionId, action);
      });
      const assertWsl = () => {
        if (
          process.platform !== 'win32' ||
          !store.snapshot().plugins.some((p) => p.enabled && p.manifest.id === 'cshell.wsl')
        )
          throw new Error('请先启用 WSL 插件');
      };
      handle('local-terminal:targets', async () => {
        if (
          process.platform !== 'win32' ||
          !store.snapshot().plugins.some((p) => p.enabled && p.manifest.id === 'cshell.wsl')
        )
          return [];
        return (await localTerminal.distributions()).distributions.map((name) => ({
          id: 'wsl:' + name,
          name,
          detail: '本机 Linux · WSL',
          shell: 'wsl:' + name,
        }));
      });
      handle('local-terminal:wsl-account', async (name) => {
        assertWsl();
        return wslAccountStatus(name);
      });
      handle('local-terminal:wsl-initialize', async (input) => {
        assertWsl();
        return initializeWslAccount(input);
      });
      handle('local-terminal:wsl', () => localTerminal.distributions());
      const wslSetup = new WslSetup();
      const wslNetwork = new WslNetworkSettings();
      handle('local-terminal:wsl-network', () => { assertWsl(); return wslNetwork.read(); });
      handle('local-terminal:wsl-network-save', (input) => { assertWsl(); return wslNetwork.save(input); });
      handle('local-terminal:wsl-restart', async () => {
        assertWsl();
        const answer = await dialog.showMessageBox(window, {
          type: 'warning',
          message: text('关闭全部 WSL 发行版以应用设置？', 'Shut down all WSL distributions to apply settings?'),
          detail: text('这会中断所有 WSL 终端、任务以及使用 WSL 的应用（包括 Docker）。再次打开终端时自动启动。请先保存工作。', 'This interrupts all WSL terminals, tasks and WSL-based apps, including Docker. WSL starts again when you open a terminal. Save your work first.'),
          buttons: [text('取消', 'Cancel'), text('关闭 WSL', 'Shut down WSL')],
          defaultId: 0, cancelId: 0,
        });
        if (answer.response !== 1) return false;
        assertWsl();
        await wslNetwork.shutdown();
        return true;
      });
      handle('local-terminal:wsl-install-status', () => wslSetup.snapshot());
      handle('local-terminal:wsl-install', (ubuntu) => {
        if (
          process.platform !== 'win32' ||
          !store.snapshot().plugins.some((p) => p.enabled && p.manifest.id === 'cshell.wsl')
        )
          throw new Error('请先启用 WSL 插件。');
        return wslSetup.start(z.boolean().parse(ubuntu));
      });
      handle('local-terminal:open', async (shell) => ({
        sessionId: await connections!.connect('cshell.local-terminal', shell, {}),
        name:
          typeof shell === 'string' && shell.startsWith('wsl:')
            ? shell.slice(4) + ' · WSL'
            : shell === 'cmd'
              ? 'CMD'
              : 'PowerShell',
      }));
      handle('local-terminal:environment', () => localTerminal.settings());
      handle('local-terminal:environment-save', (rows) => localTerminal.save(rows));
      handle('config', () => store.snapshot());
      handle('clipboard:write', (value) =>
        clipboard.writeText(z.string().max(2_000_000).parse(value)),
      );
      handle('clipboard:read', async () => (await clipboard.readText()).slice(0, 2_000_000));
      handle('profile:save', (value) => {
        const profile = profileSchema.parse(value);
        const old = store.snapshot().profiles.find((p) => p.id === profile.id);
        if (old && (old.protocol ?? 'ssh') !== (profile.protocol ?? 'ssh'))
          throw new Error('Cannot change connection protocol');
        if (profile.protocol === 'rdp') rdpProfileSchema.parse(profile);
        if (profile.protocol === 'http') http.workspace(profile.id);
        if (profile.protocol === 'client') {
          const device = clientProvider.list().find((d) => d.deviceId === profile.id);
          if (!device || device.host !== profile.host || device.port !== profile.port)
            throw new Error('Client identity or endpoint mismatch');
        }
        return store.saveProfile(profile);
      });
      handle('profile:delete', async (value) => {
        const id = idSchema.parse(value);
        if (store.profile(id).protocol === 'rdp') await rm(join(app.getPath('userData'),'rdp',id+'.rdp'),{force:true});
        if (store.profile(id).protocol === 'client') await clientProvider.forget(id);
        if (store.profile(id).protocol === 'http') await http.remove(id);
        await store.deleteProfile(id);
      });
      handle('group:manage', (action) => store.manageGroup(groupActionSchema.parse(action)));
      handle('profile:move', raw => { const input = z.object({ id: z.string().uuid(), group: z.string().max(80), before: z.string().uuid().optional() }).strict().parse(raw); return store.moveProfile(input.id, input.group, input.before); });
      handle('preferences', async (value) => {
        const preferences = preferencesSchema.parse(value);
        await store.preferences(preferences);
        if (process.platform !== 'darwin')
          window.setTitleBarOverlay(titleBarColors(preferences.theme));
      });
      handle('key:pick', async () => {
        const result = await dialog.showOpenDialog(window, {
          title: text('选择 SSH 私钥', 'Choose SSH private key'),
          properties: ['openFile'],
        });
        return result.canceled
          ? null
          : { token: grant(result.filePaths[0]), name: basename(result.filePaths[0]) };
      });
      handle('connect:cancel', (requestId) => attempts.cancel(idSchema.parse(requestId)));
      handle('connect', (id, value, requestId = randomUUID()) =>
        attempts.run(idSchema.parse(requestId), async (signal) => {
          const profile = store.profile(idSchema.parse(id)),
            credentials = credentialsSchema.parse(value);
          const saved = await store.secret(id);
          let privateKey: string | undefined;
          if (credentials.keyToken) {
            const path = consume(credentials.keyToken);
            if ((await stat(path)).size > 1_048_576)
              throw new Error('Private key exceeds size limit');
            privateKey = await readFile(path, 'utf8');
          }
          const secret =
            profile.auth === 'key'
              ? {
                  privateKey: privateKey ?? saved?.privateKey,
                  passphrase: credentials.passphrase ?? saved?.passphrase,
                }
              : { password: credentials.password ?? saved?.password };
          if (profile.auth === 'key' && !secret.privateKey) throw new Error('Select a private key');
          signal.throwIfAborted();
          const connected = {
            sessionId: await connections!.connect(profileProvider(profile), profile, secret, signal),
          };
          try {
            signal.throwIfAborted();
            await store.setSecret(id, credentials.remember ? secret : null);
          } catch (error) {
            await connections!.disconnect(connected.sessionId);
            throw error;
          }
          return connected;
        }),
      );
      handle('connect:temporary', (input, value, requestId = randomUUID()) =>
        attempts.run(idSchema.parse(requestId), async (signal) => {
          const profile = profileSchema.parse(input);
          const credentials = credentialsSchema.parse(value);
          let privateKey: string | undefined;
          if (profile.auth === 'key') {
            if (!credentials.keyToken)
              throw new Error(text('请选择私钥文件', 'Choose a private key file'));
            const path = consume(credentials.keyToken);
            if ((await stat(path)).size > 1_048_576)
              throw new Error('Private key exceeds size limit');
            privateKey = await readFile(path, 'utf8');
          }
          // Temporary sessions never read or write saved profile credentials.
          signal.throwIfAborted();
          return connections!
            .connect(
              profileProvider(profile),
              profile,
              profile.auth === 'key'
                ? { privateKey, passphrase: credentials.passphrase }
                : { password: credentials.password },
              signal,
            )
            .then((sessionId) => ({ sessionId }));
        }),
      );
      handle('floating:open', (id, snapshot) => floating!.open(id, snapshot));
      handle('disconnect', async (id) => {
        idSchema.parse(id);
        await agent.stopTarget(id);
        transfers.cancelSession(id);
        return connections!.disconnect(id);
      });
      handle('input', (id, data) =>
        connections!.tools.terminal(idSchema.parse(id)).input(z.string().max(131072).parse(data)),
      );
      handle(
        'acknowledge',
        (id, count) =>
          connections!.has(idSchema.parse(id)) &&
          connections!.tools
            .terminal(id)
            .acknowledge(z.number().int().min(0).max(2_000_000).parse(count)),
      );
      handle(
        'resize',
        (id, cols, rows) =>
          (window.isFocused() || monitorWindows.ownsSession(id) || !floating) &&
          connections!.tools
            .terminal(idSchema.parse(id))
            .resize(
              z.number().int().min(1).max(1000).parse(cols),
              z.number().int().min(1).max(1000).parse(rows),
            ),
      );
      handle('list', (id, path) =>
        connections!.tools.files(idSchema.parse(id)).list(pathSchema.parse(path)),
      );
      handle('file:action', async (id, action, path, destination) => {
        idSchema.parse(id);
        z.enum(['mkdir', 'rename', 'delete']).parse(action);
        pathSchema.parse(path);
        if (destination !== undefined) pathSchema.parse(destination);
        if (action === 'delete') {
          if (path === '/' || path === '.' || path === '..') throw new Error('Cannot delete root');
          const result = await dialog.showMessageBox(window, {
            type: 'warning',
            message: text(
              '永久删除远程文件或空目录？',
              'Permanently delete remote file or empty directory?',
            ),
            detail: path,
            buttons: [text('取消', 'Cancel'), text('删除', 'Delete')],
            defaultId: 0,
            cancelId: 0,
          });
          if (result.response !== 1) return;
        }
        if(ftp.has(id))await ftpFiles.action(id,action,path,destination);
        else await ssh.action(id, action, path, destination);
      });
      ipcMain.on('drop:register', (event, path) => {
        try {
          validateSender(event);
          event.returnValue = grant(pathSchema.parse(path));
        } catch {
          event.returnValue = '';
        }
      });
      handle('upload', async (id, path, tokens) => {
        idSchema.parse(id);
        remotePath(pathSchema.parse(path));
        if(!ftp.has(id))ssh.get(id);
        const paths = tokens
          ? z.array(idSchema).max(1000).parse(tokens).map(consume)
          : (
              await dialog.showOpenDialog(window, {
                title: text('选择上传的文件', 'Select files to upload'),
                properties: ['openFile', 'multiSelections'],
              })
            ).filePaths;
        if(ftp.has(id))ftpFiles.upload(id,paths,path);
        else for (const source of paths) transfers.enqueue(id, 'upload', source, path);
      });
      handle('download', async (id, paths) => {
        idSchema.parse(id);
        z.array(pathSchema).min(1).max(1000).parse(paths);
        if(!ftp.has(id))ssh.get(id);
        const result = await dialog.showOpenDialog(window, {
          title: text('选择下载目录', 'Choose download folder'),
          properties: ['openDirectory', 'createDirectory'],
        });
        if (!result.canceled) {
          if(ftp.has(id))ftpFiles.download(id,paths,result.filePaths[0]);
          else for (const path of paths) transfers.enqueue(id, 'download', path, result.filePaths[0]);
        }
      });
      handle('transfer:cancel', (id) => transfers.cancel(idSchema.parse(id)));
      handle('monitor', (id) => ssh.monitor(idSchema.parse(id)));
      const resources = new ResourceInspection(ssh);
      handle('resources:hardware', (id) => resources.hardware(idSchema.parse(id)));
      handle('resources:processes', (id) => resources.processes(idSchema.parse(id)));
      registerFileHandlers(handle, window, ssh, transfers, text);
      let closing = false,
        closePrompt = false;
      window.on('close', (event) => {
        if (
          closing ||
          (!ssh.size && !ftp.size && !localTerminal.size && !clientProvider.size && !transfers.size && !http.running && !disposeAi.hasActiveWork())
        )
          return;
        event.preventDefault();
        if (closePrompt) return;
        closePrompt = true;
        void dialog
          .showMessageBox(window, {
            type: 'warning',
            message: text(
              '关闭 CShell 并停止会话、传输和智能体任务？',
              'Close CShell and stop sessions, transfers, and agent tasks?',
            ),
            buttons: [text('取消', 'Cancel'), text('关闭', 'Close')],
            defaultId: 0,
            cancelId: 0,
          })
          .then((result) => {
            closePrompt = false;
            if (result.response === 1) {
              closing = true;
              window.close();
            } else {
              window.emit('update-close-cancelled');
            }
          });
      });
      let flushed = false;
      let flushing: Promise<void> | undefined;
      // will-quit runs after window close confirmation, so cancelling a close
      // never stops the user's AI tasks. Keep Electron alive until history lands.
      app.on('will-quit', (event) => {
        if (!flushed) {
          event.preventDefault();
          flushing ??= (wechat?.subscriptions.stopAll() ?? Promise.resolve()).catch(error => console.error('WeChat listener shutdown unconfirmed',error)).then(() => disposeAi())
            .catch((error) => console.error('AI shutdown failed', error))
            .then(() => machineBrowser.flush())
            .then(() => activity.flush())
            .catch((error) => console.error('Could not finish saving before exit', error))
            .finally(() => {
              flushed = true;
              app.quit();
            });
        }
      });
      window.on('closed', () => {
        attempts.dispose();
        http.dispose();
        void agent.dispose();
        void activity.flush().catch(() => {});
        floating?.dispose();
        monitorWindows.dispose();
        void mcp.stop();
        transfers.dispose();
        clientProvider.dispose();
        localTerminal.dispose();
        ftp.dispose();
        ssh.dispose();
      });
      await window.loadURL(entry);
    })
    .catch((error) => {
      diagnostics.record('startup.failed', error);
      if(error.name!=='AccountWorkspaceRestart'&&!process.env.CSHELL_TEST_DATA)dialog.showErrorBox('CShell', error.message);
      app.quit();
    });
app.on('window-all-closed', () => app.quit());
