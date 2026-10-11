import { BrowserWindow, ipcMain, screen, clipboard } from 'electron';
import { z } from 'zod';
import type { SshService } from '../core/ssh';
import type { Preferences, SessionEvent } from '../shared/contracts';
import type { TerminalSnapshot } from '../shared/floating';
const snapshotSchema = z
  .object({
    data: z.string().max(32000000),
    sequence: z.number().int().nonnegative(),
    cols: z.number().int().min(1).max(2000),
    rows: z.number().int().min(1).max(1000),
    theme: z.record(z.string(), z.string().regex(/^#[0-9a-f]{6,8}$/i)),
  })
  .strict();
type View = {
  window: BrowserWindow;
  sessionId: string;
  url: string;
  snapshot: TerminalSnapshot;
  ready: boolean;
  readOnly: boolean;
  cols: number;
  rows: number;
  closed: boolean;
};
export class FloatingWindows {
  private views = new Map<number, View>();
  private streams = new Map<
    string,
    { sequence: number; size: number; chunks: Array<{ sequence: number; data: string }> }
  >();
  constructor(
    private main: BrowserWindow,
    private ssh: SshService,
    private entry: string,
    private preload: string,
    private preferences: () => Preferences,
  ) {
    const handle = (name: string, fn: (view: View, ...args: any[]) => unknown) =>
      ipcMain.handle(name, (event, ...args) => {
        const view = this.views.get(event.sender.id);
        if (
          !view ||
          event.senderFrame !== event.sender.mainFrame ||
          event.senderFrame.url !== view.url
        )
          throw new Error('Untrusted floating window');
        return fn(view, ...args);
      });
    handle('floating:init', (view) => {
      const stream = this.streams.get(view.sessionId);
      const tail = stream?.chunks.filter((chunk) => chunk.sequence > view.snapshot.sequence) || [];
      if (
        stream &&
        stream.sequence > view.snapshot.sequence &&
        tail[0]?.sequence !== view.snapshot.sequence + 1
      )
        throw new Error('Terminal changed too quickly; reopen the window');
      view.ready = true;
      return {
        sessionId: view.sessionId,
        label: view.window.getTitle(),
        snapshot: view.snapshot,
        tail,
        preferences: this.preferences(),
        readOnly: view.readOnly,
        closed: view.closed,
      };
    });
    handle('floating:input', (view, data) => {
      if (view.readOnly) throw new Error('Observation window is read-only');
      this.ssh.input(view.sessionId, z.string().max(131072).parse(data));
    });
    handle('floating:resize', (view, cols, rows) => {
      view.cols = z.number().int().min(2).max(1000).parse(cols);
      view.rows = z.number().int().min(1).max(500).parse(rows);
      if (view.window.isFocused() && !view.readOnly && !view.closed)
        this.ssh.resize(view.sessionId, view.cols, view.rows);
    });
    handle('floating:mode', (view, readOnly) => {
      view.readOnly = z.boolean().parse(readOnly);
      if (!view.readOnly && !view.closed) this.ssh.resize(view.sessionId, view.cols, view.rows);
    });
    handle('floating:pin', (view, enabled) => {
      view.window.setAlwaysOnTop(z.boolean().parse(enabled));
      return view.window.isAlwaysOnTop();
    });
    handle('floating:copy', (_view, text) =>
      clipboard.writeText(z.string().max(2000000).parse(text)),
    );
    handle('floating:paste', async () => (await clipboard.readText()).slice(0, 131072));
    handle('floating:close', (view) => view.window.close());
    handle('floating:restore', (view) => {
      if (this.main.isMinimized()) this.main.restore();
      this.main.show();
      this.main.focus();
      this.main.webContents.send('window:focus-session', view.sessionId);
      view.window.close();
    });
  }
  event(event: SessionEvent): SessionEvent {
    if (event.type === 'data') {
      let stream = this.streams.get(event.sessionId);
      if (!stream) {
        stream = { sequence: 0, size: 0, chunks: [] };
        this.streams.set(event.sessionId, stream);
      }
      const chunk = { data: event.data, sequence: ++stream.sequence };
      stream.chunks.push(chunk);
      stream.size += chunk.data.length;
      while (stream.size > 2000000 && stream.chunks.length > 1)
        stream.size -= stream.chunks.shift()!.data.length;
      event = { ...event, sequence: chunk.sequence };
    }
    if (event.type !== 'transfer') {
      for (const view of this.views.values())
        if (view.sessionId === event.sessionId) {
          if (event.type === 'closed') view.closed = true;
          if (view.ready && !view.window.isDestroyed())
            view.window.webContents.send('floating:event', event);
        }
      if (
        event.type === 'closed' &&
        ![...this.views.values()].some((v) => v.sessionId === event.sessionId)
      )
        this.streams.delete(event.sessionId);
    }
    return event;
  }
  async open(inputId: unknown, inputSnapshot: unknown) {
    const sessionId = z.string().uuid().parse(inputId),
      snapshot = snapshotSchema.parse(inputSnapshot);
    const session = this.ssh.get(sessionId);
    if (this.views.size >= 16) throw new Error('最多同时打开 16 个小窗');
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const width = Math.min(560, area.width),
      height = Math.min(360, area.height);
    const offset = (this.views.size % 6) * 24;
    const window = new BrowserWindow({
      x: Math.max(
        area.x,
        Math.min(
          area.x + area.width - width,
          area.x + Math.round((area.width - width) / 2) + offset - 60,
        ),
      ),
      y: Math.max(area.y, Math.min(area.y + area.height - height, area.y + 60 + offset)),
      width,
      height,
      minWidth: 320,
      minHeight: 200,
      frame: false,
      show: false,
      title: session.profile.name,
      backgroundColor: this.preferences().theme === 'light' ? '#ffffff' : '#0d141b',
      webPreferences: {
        preload: this.preload,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
      },
    });
    const url = this.entry + '?floating=' + encodeURIComponent(sessionId);
    const view: View = {
      window,
      sessionId,
      url,
      snapshot,
      ready: false,
      readOnly: false,
      cols: snapshot.cols,
      rows: snapshot.rows,
      closed: false,
    };
    this.views.set(window.webContents.id, view);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.on('will-attach-webview', (event) => event.preventDefault());
    window.on('focus', () => {
      if (!view.readOnly && !view.closed) {
        try {
          this.ssh.resize(sessionId, view.cols, view.rows);
        } catch {
          /* Connection closed. */
        }
      }
    });
    const contentsId = window.webContents.id;
    window.once('closed', () => {
      this.views.delete(contentsId);
      if (view.closed && ![...this.views.values()].some((v) => v.sessionId === sessionId))
        this.streams.delete(sessionId);
    });
    window.once('ready-to-show', () => window.show());
    try {
      await window.loadURL(url);
    } catch (error) {
      window.destroy();
      throw error;
    }
  }
  dispose() {
    for (const view of this.views.values()) view.window.destroy();
    this.streams.clear();
  }
}
