import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdir, chown, writeFile, chmod, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { z } from 'zod';

const exec = promisify(execFile);
const point = { x: z.number().int().min(0).max(1439), y: z.number().int().min(0).max(899) };
export const visualInput = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('pointer'),
      phase: z.enum(['down', 'move', 'up']),
      ...point,
      button: z.enum(['left', 'right']).default('left'),
    })
    .strict(),
  z.object({ type: z.literal('release') }).strict(),
  z
    .object({
      type: z.literal('click'),
      ...point,
      button: z.enum(['left', 'right']).default('left'),
      count: z.number().int().min(1).max(2).default(1),
    })
    .strict(),
  z
    .object({ type: z.literal('wheel'), ...point, deltaY: z.number().min(-2000).max(2000) })
    .strict(),
  z.object({ type: z.literal('text'), text: z.string().max(10000) }).strict(),
  z
    .object({
      type: z.literal('key'),
      key: z.enum([
        'Enter',
        'Tab',
        'Backspace',
        'Delete',
        'Escape',
        'ArrowLeft',
        'ArrowRight',
        'ArrowUp',
        'ArrowDown',
        'Home',
        'End',
        'PageUp',
        'PageDown',
        'F5',
        'F11',
      ]),
      shift: z.boolean().optional(),
      ctrl: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('shortcut'),
      key: z.enum([
        'selectAll',
        'copy',
        'paste',
        'cut',
        'address',
        'newTab',
        'closeTab',
        'back',
        'forward',
      ]),
    })
    .strict(),
  z.object({ type: z.literal('window'), id: z.string().regex(/^0x[0-9a-f]{8,16}$/i) }).strict(),
]);
type Session = {
  uid: number;
  gid: number;
  env: NodeJS.ProcessEnv;
  profile: string;
  display: ChildProcess;
  wm: ChildProcess;
  capture?: ChildProcess;
  frame?: Buffer;
  frameTime?: number;
  apps: Map<string, ChildProcess>;
  busy: boolean;
  pointer?: string;
  lease?: ReturnType<typeof setTimeout>;
  input: Promise<unknown>;
};
const helpers = ['Xvfb', 'xauth', 'xdotool', 'xclip', 'xprop', 'openbox', 'wmctrl', 'ffmpeg'];
const appDefinitions = [
  {
    id: 'browser',
    name: '浏览器',
    executables: ['/usr/bin/google-chrome-stable', '/usr/bin/chromium'],
    args: (profile: string) => [
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-dev-shm-usage',
      '--start-maximized',
      '--user-data-dir=' + join(profile, 'browser'),
      'https://claude.ai',
    ],
  },
];
const exists = (path: string) =>
  access(path, constants.X_OK).then(
    () => true,
    () => false,
  );
const stop = (child: ChildProcess) => {
  if (child.pid && child.exitCode === null) {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {}
  }
};

/** Remote applications render on an owned X11 display, never on the controller.
 * Xauthority is private, TCP X11 is disabled, and all exec arguments are fixed
 * or validated. Separate Unix user + Chromium sandbox; not a general sandbox.
 */
export class LinuxVisualApps {
  private sessions = new Map<string, Session>();
  private opening = new Map<string, Promise<Session>>();
  private disposed = false;
  async status(owner: string) {
    if (process.platform !== 'linux')
      return { supported: false, installed: false, running: false, applications: [], missing: [] };
    const missing: string[] = [];
    for (const name of helpers) if (!(await exists('/usr/bin/' + name))) missing.push(name);
    const applications = [];
    for (const definition of appDefinitions) {
      let executable = '';
      for (const candidate of definition.executables)
        if (await exists(candidate)) {
          executable = candidate;
          break;
        }
      applications.push({
        id: definition.id,
        name: definition.name,
        installed: !!executable,
        available: !!executable && !missing.length,
        running: !!this.sessions.get(owner)?.apps.has(definition.id),
      });
    }
    return {
      supported: true,
      installed: missing.length === 0,
      running: this.sessions.has(owner),
      applications,
      missing,
      width: 1440,
      height: 900,
    };
  }
  private options(s: Pick<Session, 'uid' | 'gid' | 'env'>) {
    return { uid: s.uid, gid: s.gid, env: s.env, timeout: 10000, maxBuffer: 2 * 1024 * 1024 };
  }
  private startProcess(file: string, args: string[], s: Pick<Session, 'uid' | 'gid' | 'env'>) {
    const child = spawn(file, args, {
      uid: s.uid,
      gid: s.gid,
      env: s.env,
      detached: true,
      stdio: 'ignore',
    });
    child.on('error', () => {});
    return child;
  }
  private async create(owner: string): Promise<Session> {
    if (this.disposed) throw new Error('可视化服务已关闭');
    if (process.platform !== 'linux') throw new Error('可视化应用仅适用于 Linux');
    if (!(await this.status(owner)).installed)
      throw new Error('请先在应用市场安装 Linux 可视化应用环境');
    let uid = process.getuid!(),
      gid = process.getgid!(),
      home = homedir();
    if (uid === 0) {
      const { stdout } = await exec('/usr/bin/getent', ['passwd', 'cagent-browser'], {
        timeout: 5000,
      });
      const p = stdout.trim().split(':');
      uid = Number(p[2]);
      gid = Number(p[3]);
      home = p[5];
      if (!uid || !gid || home !== '/var/lib/cagent-browser')
        throw new Error('浏览器专用用户配置不匹配');
    }
    const profile = join(
      home,
      '.local/share/cagent-visual',
      createHash('sha256').update(owner).digest('hex'),
    );
    await mkdir(profile, { recursive: true, mode: 0o700 });
    if (process.getuid!() === 0)
      for (const p of [
        join(home, '.local'),
        join(home, '.local/share'),
        join(home, '.local/share/cagent-visual'),
        profile,
      ])
        await chown(p, uid, gid);
    const auth = join(profile, 'Xauthority');
    await writeFile(auth, '', { mode: 0o600 });
    await chmod(auth, 0o600);
    if (process.getuid!() === 0) await chown(auth, uid, gid);
    let number = randomInt(100, 2000);
    for (let i = 0; i < 200; i++, number++) {
      if (
        !(await access('/tmp/.X' + number + '-lock').then(
          () => true,
          () => false,
        )) &&
        !(await access('/tmp/.X11-unix/X' + number).then(
          () => true,
          () => false,
        ))
      )
        break;
      if (i === 199) throw new Error('没有空闲显示器');
    }
    const env = {
      PATH: '/usr/local/bin:/usr/bin:/bin',
      HOME: home,
      LANG: 'C.UTF-8',
      DISPLAY: ':' + number,
      XAUTHORITY: auth,
    };
    await exec(
      '/usr/bin/xauth',
      ['-f', auth, 'add', env.DISPLAY, 'MIT-MAGIC-COOKIE-1', randomBytes(16).toString('hex')],
      { uid, gid, env, timeout: 5000 },
    );
    const base = { uid, gid, env },
      display = this.startProcess(
        '/usr/bin/Xvfb',
        [env.DISPLAY, '-screen', '0', '1440x900x24', '-nolisten', 'tcp', '-auth', auth],
        base,
      );
    let wm: ChildProcess | undefined;
    try {
      let ready = false;
      for (let i = 0; i < 40; i++) {
        if (display.exitCode !== null) throw new Error('虚拟显示器启动失败');
        try {
          await exec('/usr/bin/xdotool', ['getdisplaygeometry'], this.options(base));
          ready = true;
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 100));
        }
      }
      if (!ready) throw new Error('虚拟显示器未就绪');
      wm = this.startProcess('/usr/bin/openbox', ['--sm-disable'], base);
      const s: Session = {
        ...base,
        profile,
        display,
        wm,
        apps: new Map(),
        busy: false,
        input: Promise.resolve(),
      };
      const capture = spawn(
        '/usr/bin/ffmpeg',
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-f',
          'x11grab',
          '-framerate',
          '8',
          '-video_size',
          '1440x900',
          '-i',
          env.DISPLAY,
          '-threads',
          '1',
          '-f',
          'image2pipe',
          '-c:v',
          'mjpeg',
          '-q:v',
          '5',
          'pipe:1',
        ],
        { uid, gid, env, detached: true, stdio: ['ignore', 'pipe', 'ignore'] },
      );
      s.capture = capture;
      capture.on('error', () => {});
      let bytes = Buffer.alloc(0);
      capture.stdout.on('data', (chunk: Buffer) => {
        bytes = Buffer.concat([bytes, chunk]);
        if (bytes.length > 3 * 1024 * 1024) {
          stop(capture);
          bytes = Buffer.alloc(0);
          return;
        }
        for (;;) {
          const end = bytes.indexOf(Buffer.from([255, 217]));
          if (end < 0) break;
          const frame = bytes.subarray(0, end + 2);
          bytes = bytes.subarray(end + 2);
          if (frame[0] === 255 && frame[1] === 216 && frame.length <= 1100000) {
            s.frame = frame;
            s.frameTime = Date.now();
          }
        }
      });
      if (this.disposed) throw new Error('可视化服务已关闭');
      display.once('exit', () => {
        if (this.sessions.get(owner) === s) {
          this.sessions.delete(owner);
          for (const child of s.apps.values()) stop(child);
          stop(s.wm);
          if (s.capture) stop(s.capture);
        }
      });
      this.sessions.set(owner, s);
      return s;
    } catch (e) {
      stop(display);
      if (wm) stop(wm);
      await unlink(auth).catch(() => {});
      throw e;
    }
  }
  private async ensure(owner: string) {
    let s = this.sessions.get(owner);
    if (s) return s;
    let pending = this.opening.get(owner);
    if (!pending) {
      if (this.sessions.size + this.opening.size >= 4) throw new Error('可视化会话已满');
      pending = this.create(owner).finally(() => this.opening.delete(owner));
      this.opening.set(owner, pending);
    }
    return pending;
  }
  async launch(owner: string, input: unknown) {
    const { app } = z
        .object({ app: z.literal('browser') })
        .strict()
        .parse(input),
      definition = appDefinitions.find((a) => a.id === app)!;
    let executable = '';
    for (const p of definition.executables)
      if (await exists(p)) {
        executable = p;
        break;
      }
    if (!executable) throw new Error('应用尚未安装，请前往应用市场');
    const s = await this.ensure(owner);
    if (s.apps.has(app)) return this.status(owner);
    const child = this.startProcess(executable, definition.args(s.profile), s);
    s.apps.set(app, child);
    child.once('exit', () => {
      if (s.apps.get(app) === child) s.apps.delete(app);
    });
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    return this.status(owner);
  }
  private get(owner: string) {
    const s = this.sessions.get(owner);
    if (!s) throw new Error('远端可视化会话未运行');
    return s;
  }
  async frame(owner: string) {
    const s = this.get(owner);
    if (!s.frame || !s.frameTime || Date.now() - s.frameTime > 5000)
      throw new Error('正在等待新的应用画面');
    return {
      data: s.frame.toString('base64'),
      width: 1440,
      height: 900,
      windows: await Promise.all(
        (await this.windows(s)).map(async (w) => {
          const state = await exec(
            '/usr/bin/xprop',
            ['-id', w.id, '_NET_WM_STATE'],
            this.options(s),
          ).catch(() => null);
          return {
            ...w,
            ...(state ? { minimized: state.stdout.includes('_NET_WM_STATE_HIDDEN') } : {}),
          };
        }),
      ),
    };
  }
  private async windows(s: Session) {
    const { stdout } = await exec('/usr/bin/wmctrl', ['-l'], this.options(s));
    return stdout
      .trim()
      .split('\n')
      .map((line) => {
        const match = line.match(/^(0x[\da-f]+)\s+\S+\s+\S+\s*(.*)$/i);
        return match ? { id: match[1], title: match[2] } : null;
      })
      .filter((v): v is { id: string; title: string } => !!v)
      .slice(0, 32);
  }
  async input(owner: string, raw: unknown) {
    const p = visualInput.parse(raw),
      s = this.get(owner);
    const action = s.input.then(async () => {
      if (this.sessions.get(owner) !== s) throw new Error('会话已关闭');
      const run = (args: string[]) => exec('/usr/bin/xdotool', args, this.options(s));
      if (p.type === 'release') {
        clearTimeout(s.lease);
        if (s.pointer) {
          await run(['mouseup', s.pointer]);
          s.pointer = undefined;
        }
      } else if (p.type === 'pointer') {
        clearTimeout(s.lease);
        if (p.phase === 'down') {
          if (s.pointer) await run(['mouseup', s.pointer]);
          s.pointer = p.button === 'left' ? '1' : '3';
          await run(['mousemove', String(p.x), String(p.y), 'mousedown', s.pointer]);
        } else if (p.phase === 'move' && s.pointer)
          await run(['mousemove', String(p.x), String(p.y)]);
        else if (p.phase === 'up' && s.pointer) {
          await run(['mousemove', String(p.x), String(p.y), 'mouseup', s.pointer]);
          s.pointer = undefined;
        }
        if (s.pointer)
          s.lease = setTimeout(() => {
            void this.input(owner, { type: 'release' }).catch(() => {});
          }, 3000);
      } else if (p.type === 'click')
        await run([
          'mousemove',
          String(p.x),
          String(p.y),
          'click',
          '--repeat',
          String(p.count),
          '--delay',
          '100',
          p.button === 'left' ? '1' : '3',
        ]);
      else if (p.type === 'wheel')
        await run([
          'mousemove',
          String(p.x),
          String(p.y),
          'click',
          '--repeat',
          String(Math.min(12, Math.max(1, Math.ceil(Math.abs(p.deltaY) / 100)))),
          p.deltaY < 0 ? '4' : '5',
        ]);
      else if (p.type === 'window') {
        if (!(await this.windows(s)).some((w) => w.id === p.id)) throw new Error('窗口已关闭');
        await exec('/usr/bin/wmctrl', ['-ia', p.id], this.options(s));
      } else if (p.type === 'text') {
        if (/^[\x20-\x7e]+$/.test(p.text)) {
          await run(['type', '--clearmodifiers', '--delay', '0', '--', p.text]);
          return { ok: true };
        }
        await new Promise<void>((resolve, reject) => {
          const child = spawn(
            '/usr/bin/xclip',
            ['-selection', 'clipboard', '-target', 'UTF8_STRING', '-in'],
            { ...this.options(s), stdio: ['pipe', 'ignore', 'pipe'] },
          );
          child.on('error', reject);
          child.once('exit', (code) =>
            code === 0 ? resolve() : reject(new Error('远端剪贴板写入失败')),
          );
          child.stdin.end(p.text);
        });
        await run(['key', '--clearmodifiers', 'ctrl+v']);
      } else if (p.type === 'shortcut') {
        const keys = {
          selectAll: 'ctrl+a',
          copy: 'ctrl+c',
          paste: 'ctrl+v',
          cut: 'ctrl+x',
          address: 'ctrl+l',
          newTab: 'ctrl+t',
          closeTab: 'ctrl+w',
          back: 'alt+Left',
          forward: 'alt+Right',
        };
        await run(['key', '--clearmodifiers', keys[p.key]]);
      } else if (p.type === 'key') {
        const keys: Record<string, string> = {
          Enter: 'Return',
          Backspace: 'BackSpace',
          ArrowLeft: 'Left',
          ArrowRight: 'Right',
          ArrowUp: 'Up',
          ArrowDown: 'Down',
          PageUp: 'Prior',
          PageDown: 'Next',
        };
        await run([
          'key',
          '--clearmodifiers',
          (p.ctrl ? 'ctrl+' : '') + (p.shift ? 'shift+' : '') + (keys[p.key] ?? p.key),
        ]);
      }
      return { ok: true };
    });
    s.input = action.catch(() => {});
    return action;
  }
  async close(owner: string) {
    await this.opening.get(owner)?.catch(() => {});
    const s = this.sessions.get(owner);
    this.sessions.delete(owner);
    if (s) {
      clearTimeout(s.lease);
      for (const child of s.apps.values()) stop(child);
      if (s.capture) stop(s.capture);
      stop(s.wm);
      stop(s.display);
    }
    return { closed: true };
  }
  async dispose() {
    this.disposed = true;
    await Promise.allSettled([...this.opening.values()]);
    await Promise.all([...this.sessions.keys()].map((o) => this.close(o)));
  }
}
