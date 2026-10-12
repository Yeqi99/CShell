import {
  app,
  clipboard,
  BrowserWindow,
  ipcMain,
  safeStorage,
  Menu,
  session,
  screen,
} from 'electron';
import { z } from 'zod';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { networkInterfaces } from 'node:os';
import { Store, type SecretCodec } from '../core/store';
import { LocalTerminalProvider } from '../core/connections/local-terminal-provider';
import { ClientVault } from '../core/client/identity';
import { ClientServer } from '../core/client/server';
import { initialWindowBounds } from './window-bounds';
export const clientCodec: SecretCodec = {
  async encrypt(value) {
    if (
      !safeStorage.isEncryptionAvailable() ||
      (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
    )
      throw new Error('Windows secure storage unavailable');
    return (await safeStorage.encryptStringAsync(value)).toString('base64');
  },
  async decrypt(value) {
    return (await safeStorage.decryptStringAsync(Buffer.from(value, 'base64'))).result;
  },
};
export async function startClientApplication() {
  if (process.platform !== 'win32') throw new Error('CShell Client preview requires Windows');
  const directory = app.getPath('userData');
  const store = new Store(directory, clientCodec);
  await store.load();
  let service: ClientServer;
  const terminal = new LocalTerminalProvider(directory, store, (event) => service.event(event));
  await terminal.load();
  service = new ClientServer(new ClientVault(join(directory, 'client'), clientCodec), terminal);
  await service.load();
  const entry = pathToFileURL(join(__dirname, '../renderer/index.html')).href + '?client';
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const bounds = initialWindowBounds(area);
  const win = new BrowserWindow({
    ...bounds,
    minWidth: Math.min(440, area.width),
    minHeight: Math.min(440, area.height),
    x: Math.round(area.x + (area.width - Math.min(560, area.width)) / 2),
    y: Math.round(area.y + (area.height - Math.min(580, area.height)) / 2),
    width: Math.min(560, area.width),
    height: Math.min(580, area.height),
    title: 'CShell Client',
    icon: join(app.getAppPath(), 'assets/icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#ffffff', symbolColor: '#233248', height: 40 },
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  Menu.setApplicationMenu(null);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());
  session.defaultSession.setPermissionRequestHandler((_w, _p, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  const handle = (name: string, fn: (...args: any[]) => unknown) =>
    ipcMain.handle(name, (event, ...args) => {
      if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame)
        throw new Error('Unauthorized frame');
      return fn(...args);
    });
  handle('client:status', () => ({
    ...service.status(),
    interfaces: [
      ...new Set([
        '127.0.0.1',
        ...Object.values(networkInterfaces()).flatMap(
          (rows) => rows?.filter((r) => r.family === 'IPv4').map((r) => r.address) ?? [],
        ),
      ]),
    ],
  }));
  handle('clipboard:write', (value) => clipboard.writeText(z.string().max(16384).parse(value)));
  handle('client:theme', (value) => {
    const dark = z.enum(['light', 'dark']).parse(value) === 'dark';
    win.setTitleBarOverlay({
      color: dark ? '#0d141b' : '#ffffff',
      symbolColor: dark ? '#dce5ee' : '#233248',
      height: 40,
    });
    win.setBackgroundColor(dark ? '#10161d' : '#eef2f7');
  });
  handle('client:access', (options) => service.setAccess(options));
  handle('client:info', (host) => service.connectionInfo(z.string().max(253).parse(host)));
  handle('client:start', (options) => service.start(options));
  handle('client:stop', () => service.stop());
  handle('client:invite', (options) => service.invite(options));
  handle('client:revoke', (id) => service.revoke(id));
  let stopping = false;
  win.on('close', (event) => {
    if (stopping) return;
    event.preventDefault();
    stopping = true;
    void service.stop().finally(() => {
      terminal.dispose();
      win.destroy();
    });
  });
  app.on('second-instance', () => {
    win.show();
    win.focus();
  });
  await win.loadURL(entry);
}
