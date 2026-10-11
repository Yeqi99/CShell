import { LocalTerminalProvider } from '../core/connections/local-terminal-provider';
import { createSshManager } from '../core/connections/ssh-provider';
import type { ConnectionManager } from '../core/connections/manager';
import { ActivityStore } from '../core/activity';
import { registerActivity } from './activity';
import type { Activity } from '../shared/activity';
import { FloatingWindows } from './floating';
import { registerExtensionHandlers } from './extensions';
import { registerUpdateHandlers } from './updates';
import { initialWindowBounds } from './window-bounds';
import { registerAiHandlers } from './ai';
import { DockerService } from '../core/docker';
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
} from 'electron';
import { join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile, stat } from 'node:fs/promises';
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

let window: BrowserWindow;
let ssh: SshService;
let transfers: Transfers;
const idSchema = z.string().uuid();
const pathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((p) => !/[\0\r\n]/.test(p));
if (process.env.CSHELL_TEST_DATA) app.setPath('userData', process.env.CSHELL_TEST_DATA);
const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();
else
  app
    .whenReady()
    .then(async () => {
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
        title: 'CShell · CanpShell',
        icon: join(app.getAppPath(), 'assets/icon.png'),
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
      Menu.setApplicationMenu(null);
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (event) => event.preventDefault());
      window.webContents.on('will-attach-webview', (event) => event.preventDefault());
      session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) =>
        callback(false),
      );
      session.defaultSession.setPermissionCheckHandler(() => false);
      let connections: ConnectionManager | undefined;
      let floating: FloatingWindows | undefined;
      const emit = (event: SessionEvent) => {
        if (event.type === 'closed') connections?.closed(event.sessionId);
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
      };
      ssh = new SshService(emit, async (profile, fingerprint) => {
        const endpoint = `${profile.host.toLowerCase()}:${profile.port}`,
          known = store.host(endpoint);
        if (known === fingerprint) return true;
        if (known) {
          await dialog.showMessageBox(window, {
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
        if (result.response !== 1) return false;
        await store.trust(endpoint, fingerprint);
        return true;
      });
      connections = createSshManager(ssh, () => store.snapshot().profiles);
      const localTerminal = new LocalTerminalProvider(app.getPath('userData'), store, emit);
      await localTerminal.load();
      connections.register(localTerminal);
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
          event.sender !== window.webContents ||
          event.senderFrame !== window.webContents.mainFrame ||
          event.senderFrame.url !== entry
        )
          throw new Error('Untrusted IPC sender');
      };
      const handle = (name: string, fn: (...args: any[]) => any) =>
        ipcMain.handle(name, async (event, ...args) => {
          validateSender(event);
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
            return result;
          } catch (error) {
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
      registerAppearanceHandlers(handle, window, app.getPath('userData'), consume, text);
      registerUpdateHandlers(handle, window);
      registerActivity(handle, window, activity);
      let normalBounds: Electron.Rectangle | null = null;
      let wasMaximized = false;
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
      await registerAiHandlers(handle, app.getPath('userData'), store, connections.tools);
      registerPresetHandlers(handle, window, app.getPath('userData'), store, text);
      const mcp = new McpService(store, app.getPath('userData'), async (name, command) => {
        const result = await dialog.showMessageBox(window, {
          type: 'warning',
          title: text('MCP 请求执行命令', 'MCP command request'),
          message: name,
          detail: command,
          buttons: [text('拒绝', 'Reject'), text('执行', 'Execute')],
          defaultId: 0,
          cancelId: 0,
        });
        return result.response === 1;
      });
      let mcpWrites = Promise.resolve();
      const serialMcp = <T>(fn: () => Promise<T>) => {
        const result = mcpWrites.catch(() => {}).then(fn);
        mcpWrites = result.then(() => {});
        return result;
      };
      handle('mcp:status', () => mcp.status());
      handle('mcp:configure', (settings) => serialMcp(() => mcp.configure(settings)));
      handle('mcp:copy-token', async () => clipboard.writeText(await mcp.accessToken()));
      handle('mcp:rotate-token', () => serialMcp(() => mcp.rotateToken()));
      await mcp.start();
      registerExtensionHandlers(handle, window, store, ssh, connections);
      const docker = new DockerService(ssh, () => {
        const tools = store.snapshot().tools;
        if (!tools.dockerEnabled) throw new Error(text('Docker 面板未启用', 'Docker is disabled'));
        return tools.dockerSocket;
      });
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
      handle('local-terminal:wsl', () => localTerminal.distributions());
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
      handle('profile:save', (value) => store.saveProfile(profileSchema.parse(value)));
      handle('profile:delete', (id) => store.deleteProfile(idSchema.parse(id)));
      handle('group:manage', (action) => store.manageGroup(groupActionSchema.parse(action)));
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
      handle('connect', async (id, value) => {
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
        const connected = { sessionId: await connections!.connect('cshell.ssh', profile, secret) };
        try {
          await store.setSecret(id, credentials.remember ? secret : null);
        } catch (error) {
          await connections!.disconnect(connected.sessionId);
          throw error;
        }
        return connected;
      });
      handle('connect:temporary', async (input, value) => {
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
        return connections!
          .connect(
            'cshell.ssh',
            profile,
            profile.auth === 'key'
              ? { privateKey, passphrase: credentials.passphrase }
              : { password: credentials.password },
          )
          .then((sessionId) => ({ sessionId }));
      });
      handle('floating:open', (id, snapshot) => floating!.open(id, snapshot));
      handle('disconnect', (id) => {
        idSchema.parse(id);
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
          (window.isFocused() || !floating) &&
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
        await ssh.action(id, action, path, destination);
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
        ssh.get(id);
        const paths = tokens
          ? z.array(idSchema).max(1000).parse(tokens).map(consume)
          : (
              await dialog.showOpenDialog(window, {
                title: text('选择上传的文件', 'Select files to upload'),
                properties: ['openFile', 'multiSelections'],
              })
            ).filePaths;
        for (const source of paths) transfers.enqueue(id, 'upload', source, path);
      });
      handle('download', async (id, paths) => {
        idSchema.parse(id);
        z.array(pathSchema).min(1).max(1000).parse(paths);
        ssh.get(id);
        const result = await dialog.showOpenDialog(window, {
          title: text('选择下载目录', 'Choose download folder'),
          properties: ['openDirectory', 'createDirectory'],
        });
        if (!result.canceled)
          for (const path of paths) transfers.enqueue(id, 'download', path, result.filePaths[0]);
      });
      handle('transfer:cancel', (id) => transfers.cancel(idSchema.parse(id)));
      handle('monitor', (id) => ssh.monitor(idSchema.parse(id)));
      const resources = new ResourceInspection(ssh);
      handle('resources:hardware', (id) => resources.hardware(idSchema.parse(id)));
      handle('resources:processes', (id) => resources.processes(idSchema.parse(id)));
      registerFileHandlers(handle, window, ssh, transfers, text);
      window.once('ready-to-show', () => window.show());
      let closing = false,
        closePrompt = false;
      window.on('close', (event) => {
        if (closing || (!ssh.size && !localTerminal.size && !transfers.size)) return;
        event.preventDefault();
        if (closePrompt) return;
        closePrompt = true;
        void dialog
          .showMessageBox(window, {
            type: 'warning',
            message: text(
              '关闭 CShell 并断开所有会话和传输？',
              'Close CShell and disconnect all sessions and transfers?',
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
            }
          });
      });
      let flushed = false;
      app.on('before-quit', (event) => {
        if (!flushed) {
          event.preventDefault();
          void activity
            .flush()
            .catch(() => {})
            .finally(() => {
              flushed = true;
              app.quit();
            });
        }
      });
      window.on('closed', () => {
        void activity.flush().catch(() => {});
        floating?.dispose();
        void mcp.stop();
        transfers.dispose();
        localTerminal.dispose();
        ssh.dispose();
      });
      app.on('second-instance', () => {
        if (window.isMinimized()) window.restore();
        window.focus();
      });
      await window.loadURL(entry);
    })
    .catch((error) => {
      dialog.showErrorBox('CShell', error.message);
      app.quit();
    });
app.on('window-all-closed', () => app.quit());
