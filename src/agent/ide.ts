import { ideLaunch } from './ide-launch';
import { homedir } from 'node:os';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { z } from 'zod';
import type { ClientVault } from '../core/client/identity';
const exec = promisify(execFile);
const configuration = z.object({ directory: z.string(), executable: z.string().default('') });
/** One private IDE process per authenticated controller; never exposes a public listener. */
export class IdeService {
  private config: z.infer<typeof configuration>;
  private plans = new Map<
    string,
    { owner: string; directory: string; url: string; digest: string; version: string; name: string }
  >();
  private processes = new Map<
    string,
    { child: ChildProcess; url: string; password: string; cwd: string }
  >();
  private installing = false;
  private installAbort?:AbortController;
  private installOwner='';
  private installError = '';
  constructor(
    private vault: ClientVault,
    directory: string,
    private allowed: (owner: string) => boolean,
  ) {
    this.config = { directory: join(directory, 'ide'), executable: '' };
  }
  async load() {
    this.config = (await this.vault.read('ide-config', configuration)) ?? this.config;
  }
  private guard(owner: string) {
    if (!this.allowed(owner)) throw Error('IDE 操作未授权');
  }
  async call(method: string, raw: unknown, owner: string): Promise<unknown> {
    this.guard(owner);
    if (method === 'ide.status') {
      let version = '',
        reason = '尚未安装';
      if (this.config.executable)
        try {
          version = (
            await exec(this.config.executable, ['--version'], {
              timeout: 10000,
              windowsHide: true,
              maxBuffer: 16384,
            })
          ).stdout.trim();
        } catch (e) {
          reason = String(e);
        }
      const p = this.processes.get(owner);
      return {
        ready: !!version,
        launchVersion: 1,
        version,
        reason: version ? '' : reason,
        directory: this.config.directory,
        installing: this.installing,
        installError: this.installError,
        supported:
          ['linux', 'darwin'].includes(process.platform) && ['x64', 'arm64'].includes(process.arch),
        running: p ? { url: p.url, password: p.password, cwd: p.cwd } : undefined,
      };
    }
    if (method === 'ide.plan') {
      if (
        !['linux', 'darwin'].includes(process.platform) ||
        !['x64', 'arm64'].includes(process.arch)
      )
        throw Error('此平台暂未提供 code-server 独立安装包；Windows 可在真实 WSL 连接中安装');
      const { directory } = z
        .object({ directory: z.string().min(1).max(4096) })
        .strict()
        .parse(raw);
      if (!isAbsolute(directory)) throw Error('请选择绝对安装路径');
      const response = await fetch(
        'https://api.github.com/repos/coder/code-server/releases/latest',
        { signal: AbortSignal.timeout(20000) },
      );
      if (!response.ok) throw Error('无法读取官方版本');
      const release = (await response.json()) as any;
      const version = String(release.tag_name).replace(/^v/, '');
      if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error('官方版本无效');
      const name = `code-server-${version}-${process.platform === 'darwin' ? 'macos' : 'linux'}-${process.arch === 'x64' ? 'amd64' : 'arm64'}.tar.gz`;
      const asset = release.assets?.find((a: any) => a.name === name);
      if (
        !asset ||
        !/^sha256:[a-f0-9]{64}$/.test(asset.digest) ||
        asset.browser_download_url !==
          `https://github.com/coder/code-server/releases/download/v${version}/${name}`
      )
        throw Error('此版本没有可核验的独立安装包');
      const id = randomUUID();
      this.plans.clear();
      this.plans.set(id, {
        owner,
        directory,
        url: asset.browser_download_url,
        digest: asset.digest.slice(7),
        version,
        name,
      });
      return {
        id,
        version,
        directory,
        steps: [
          '下载官方独立安装包并核验 SHA256',
          '程序、运行时、扩展和配置保存在所选目录',
          '仅监听目标机器回环地址，通过当前机器浏览器访问',
        ],
      };
    }
    if(method==='ide.cancel'){if(this.installOwner!==owner)throw Error('安装任务不属于当前控制端');this.installAbort?.abort();return {cancelled:true};}
    if (method === 'ide.install') {
      if (this.installing) throw Error('已有安装任务');
      const { id } = z
        .object({ id: z.string().uuid(), confirm: z.literal(true) })
        .strict()
        .parse(raw);
      const plan = this.plans.get(id);
      if (!plan || plan.owner !== owner) throw Error('安装计划已过期');
      if (this.processes.size) throw Error('请先停止 IDE');
      this.installing = true;
      this.installError = '';
      this.installAbort=new AbortController();this.installOwner=owner;
      void this.call('ide.install.execute', raw, owner)
        .catch((e) => {
          this.installError = String(e);
        })
        .finally(() => {
          this.installing = false;
        });
      return { started: true };
    }
    if (method === 'ide.install.execute') {
      const { id } = z
        .object({ id: z.string().uuid(), confirm: z.literal(true) })
        .strict()
        .parse(raw);
      const plan = this.plans.get(id);
      if (!plan || plan.owner !== owner) throw Error('安装计划已过期');
      if (this.processes.size) throw Error('请先停止 IDE');
      this.plans.delete(id);
      this.installing = true;
      try {
        await mkdir(plan.directory, { recursive: true });
        const response = await fetch(plan.url, { signal: AbortSignal.any([AbortSignal.timeout(300000),this.installAbort!.signal]) });
        if (!response.ok || !response.body) throw Error('安装包下载失败');
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of response.body as any) {
          this.guard(owner);this.installAbort?.signal.throwIfAborted();
          size += chunk.length;
          if (size > 350 * 1024 * 1024) throw Error('安装包超过大小限制');
          chunks.push(Buffer.from(chunk));
        }
        const data = Buffer.concat(chunks);
        if (createHash('sha256').update(data).digest('hex') !== plan.digest)
          throw Error('安装包摘要不一致');
        const archive = join(plan.directory, plan.name);
        await writeFile(archive, data, { mode: 0o600 });
        const list = (
          await exec('tar', ['-tzf', archive], { timeout: 30000, maxBuffer: 8 * 1024 * 1024, signal:this.installAbort?.signal })
        ).stdout
          .split('\n')
          .filter(Boolean);
        const root = plan.name.replace(/\.tar\.gz$/, '');
        if (
          !list.length ||
          list.some(
            (p) => !p.startsWith(root + '/') || p.split('/').includes('..') || p.includes('\\'),
          )
        )
          throw Error('安装包路径无效');
        const stage = join(plan.directory, 'stage-' + randomUUID());
        await mkdir(stage);
        await exec('tar', ['-xzf', archive, '-C', stage], { timeout: 120000, signal:this.installAbort?.signal, maxBuffer: 65536 });
        const executable = join(stage, root, 'bin', 'code-server');
        const version = (
          await exec(executable, ['--version'], { timeout: 15000, maxBuffer: 16384 })
        ).stdout;
        if (!version.includes(plan.version)) throw Error('客户端版本核验失败');
        this.guard(owner);
        this.config = { directory: plan.directory, executable };
        await this.vault.write('ide-config', this.config);
        return { installed: true, version: plan.version };
      } finally {
        this.installing = false;
      }
    }
    if (method === 'ide.stop') {
      this.stop(owner);
      return { stopped: true };
    }
    if (method === 'ide.start') {
      const input = z
        .object({ cwd: z.string().max(4096).default('') })
        .strict()
        .parse(raw);
      const cwd = input.cwd || this.processes.get(owner)?.cwd || homedir();
      if (!isAbsolute(cwd) || !(await stat(cwd)).isDirectory()) throw Error('项目目录不存在');
      const existing = this.processes.get(owner);
      if (existing) {
        if (existing.cwd !== cwd) throw Error('请先停止当前项目');
        return { url: await ideLaunch(existing.url, existing.password, () => this.allowed(owner)), cwd };
      }
      if (!this.config.executable || this.installing) throw Error('请先完成 IDE 安装');
      if (this.processes.size >= 4) throw Error('IDE 会话数已达上限');
      const port = await new Promise<number>((resolve, reject) => {
        const s = createServer();
        s.once('error', reject);
        s.listen(0, '127.0.0.1', () => {
          const p = (s.address() as any).port;
          s.close(() => resolve(p));
        });
      });
      const directory = join(
        this.config.directory,
        'profiles',
        createHash('sha256').update(owner).digest('hex'),
      );
      await mkdir(directory, { recursive: true });
      const password = randomBytes(24).toString('base64url'),
        url = `http://127.0.0.1:${port}/` + (input.cwd ? `?folder=${encodeURIComponent(cwd)}` : '');
      const child = spawn(
        this.config.executable,
        [
          '--bind-addr',
          `127.0.0.1:${port}`,
          '--auth',
          'password',
          '--disable-telemetry',
          '--disable-update-check',
          '--user-data-dir',
          join(directory, 'data'),
          '--extensions-dir',
          join(directory, 'extensions'),
          ...(input.cwd ? [cwd] : []),
        ],
        {
          cwd,
          windowsHide: true,
          detached: process.platform !== 'win32',
          env: {
            ...process.env,
            PASSWORD: password,
            XDG_CONFIG_HOME: join(directory, 'config'),
            XDG_CACHE_HOME: join(directory, 'cache'),
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      let log = '';
      child.stdout?.on('data', (b) => (log = (log + b).slice(-4000)));
      child.stderr?.on('data', (b) => (log = (log + b).slice(-4000)));
      const record = { child, url, password, cwd };
      this.processes.set(owner, record);
      const timer = setInterval(() => {
        if (!this.allowed(owner)) this.stop(owner);
      }, 1000);
      child.once('exit', () => {
        clearInterval(timer);
        if (this.processes.get(owner) === record) this.processes.delete(owner);
      });
      child.once('error', () => {
        clearInterval(timer);
        this.processes.delete(owner);
      });
      for (let i = 0; i < 100; i++) {
        this.guard(owner);
        if (child.exitCode !== null || child.killed) {
          this.stop(owner);
          throw Error('IDE 启动失败：' + log.replaceAll(password, '[隐藏]'));
        }
        let healthy = false;
        try {
          const r = await fetch(`http://127.0.0.1:${port}/healthz`, {
            signal: AbortSignal.timeout(500),
          });
          healthy = r.ok;
        } catch {}
        if (healthy) return { url: await ideLaunch(url, password, () => this.allowed(owner)), cwd };
        await new Promise((r) => setTimeout(r, 200));
      }
      this.stop(owner);
      throw Error('IDE 启动超时');
    }
    throw Error('未知 IDE 操作');
  }
  private stop(owner: string) {
    const p = this.processes.get(owner);
    if (!p) return;
    this.processes.delete(owner);
    try {
      if (process.platform !== 'win32' && p.child.pid) process.kill(-p.child.pid, 'SIGTERM');
      else p.child.kill();
    } catch {
      p.child.kill();
    }
  }
  close() {
    this.installAbort?.abort();
    for (const owner of this.processes.keys()) this.stop(owner);
  }
}
