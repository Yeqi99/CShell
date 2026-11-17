import {linuxBrowserInstall} from './linux-browser-install';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { databaseRecipes, isDatabaseApp, type DatabaseApp } from '../shared/database-apps';
import {installNative,nativePort,restoreNative} from './native-database';
import {nativeArch,nativeVersions} from './native-database-install';
import { databaseHost, databasePort, installDatabase } from './database-apps';
import { createHash, randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  appPolicySchema,
  appPlanInput,
  appTaskInput,
  appInstallInput,
  appTaskSchema,
} from '../shared/agent-applications';
import type { ClientVault } from '../core/client/identity';

const exec = promisify(execFile);
type Manager = 'winget' | 'brew' | 'apt-get' | 'dnf';
type App = z.infer<typeof appPlanInput>['app'];
type Task = z.infer<typeof appTaskSchema>;
const recipes: Record<Manager, Partial<Record<App, string>>> = {
  winget: {
    git: 'Git.Git',
    nodejs: 'OpenJS.NodeJS.LTS',
    python: 'Python.Python.3.13',
    vscode: 'Microsoft.VisualStudioCode',
    '7zip': '7zip.7zip',
    curl: 'cURL.cURL',
    jq: 'jqlang.jq',
    ripgrep: 'BurntSushi.ripgrep.MSVC',
    ffmpeg: 'Gyan.FFmpeg',
  },
  brew: {
    git: 'git',
    nodejs: 'node',
    python: 'python@3.13',
    vscode: 'visual-studio-code',
    '7zip': 'sevenzip',
    curl: 'curl',
    jq: 'jq',
    ripgrep: 'ripgrep',
    ffmpeg: 'ffmpeg',
  },
  'apt-get': {
    ...(process.arch==='x64'?{browser:'google-chrome-stable'}:{}),
    git: 'git',
    nodejs: 'nodejs',
    python: 'python3',
    '7zip': 'p7zip-full',
    curl: 'curl',
    jq: 'jq',
    ripgrep: 'ripgrep',
    ffmpeg: 'ffmpeg',
  },
  dnf: {
    git: 'git',
    nodejs: 'nodejs',
    python: 'python3',
    curl: 'curl',
    jq: 'jq',
    ripgrep: 'ripgrep',
  },
};
export function installArgs(manager: Manager, app: App) {
  const pkg = recipes[manager][app];
  if (!pkg) throw new Error('该包管理器未提供此应用配方');
  if (manager === 'winget')
    return [
      'install',
      '--id',
      pkg,
      '--exact',
      '--source',
      'winget',
      '--silent',
      '--no-upgrade',
      '--disable-interactivity',
      '--accept-package-agreements',
      '--accept-source-agreements',
    ];
  if (manager === 'brew') return ['install', ...(app === 'vscode' ? ['--cask'] : []), pkg];
  return ['install', '-y', pkg];
}
export async function detectPackageManager(): Promise<
  { manager: Manager; executable: string } | undefined
> {
  const candidates: [Manager, string][] =
    process.platform === 'win32'
      ? [['winget', join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps', 'winget.exe')]]
      : process.platform === 'darwin'
        ? [
            ['brew', '/opt/homebrew/bin/brew'],
            ['brew', '/usr/local/bin/brew'],
          ]
        : process.platform === 'linux'
          ? [
              ['apt-get', '/usr/bin/apt-get'],
              ['dnf', '/usr/bin/dnf'],
            ]
          : [];
  for (const [manager, executable] of candidates) {
    try {
      await access(executable, constants.X_OK);
      await exec(executable, ['--version'], { windowsHide: true, timeout: 5000, maxBuffer: 16384 });
      return { manager, executable };
    } catch {
      /* Report unavailable rather than silently installing a package manager. */
    }
  }
}

export class AgentApplicationService {
  private checking?: ReturnType<typeof detectPackageManager>;
  private planning = new Set<Promise<unknown>>();
  private closing = new AbortController();
  private policy = appPolicySchema.parse({});
  private tasks = new Map<string, { owner: string; task: Task }>();
  private starting = false;
  private active?: {
    child?: ChildProcess;
    task: Task;
    done: Promise<void>;
    stop: (reason: string) => void;
  };
  private writes = Promise.resolve();
  get activity(){return this.planning.size+(this.active?1:0);}
  constructor(
    private vault: ClientVault,
    private permitted: (owner: string) => boolean,
  ) {}
  async load() {
    this.policy =
      (await this.vault.read('applications-policy', appPolicySchema)) ?? appPolicySchema.parse({});
    const saved =
      (await this.vault.read(
        'applications-tasks',
        z.array(z.object({ owner: z.string(), task: appTaskSchema })).max(50),
      )) ?? [];
    for (const entry of saved) {
      if (entry.task.state === 'running') {
        entry.task.state = 'interrupted';
        entry.task.logs += '\nAgent 已重启，安装结果未知；先检查系统再决定是否重试。';
      }
      this.tasks.set(entry.task.id, entry);
    }
    if(nativeArch && this.policy.enabled){
      for(const app of Object.keys(nativeVersions) as DatabaseApp[]){
        void restoreNative(this.nativeRoot(app),app,this.closing.signal).catch(error=>{
          if(!this.closing.signal.aborted)console.warn('数据库恢复失败',app,String(error));
        });
      }
    }
  }
  private persist() {
    const snapshot = structuredClone([...this.tasks.values()]);
    const next = this.writes.then(() => this.vault.write('applications-tasks', snapshot));
    this.writes = next.catch(() => {});
    return next;
  }
  private allowed(owner: string) {
    return (
      !this.closing.signal.aborted &&
      this.policy.enabled &&
      (owner === 'local' || ((this.policy.controllers.includes('*')||this.policy.controllers.includes(owner)) && this.permitted(owner)))
    );
  }
  private authorize(owner: string) {
    if (!this.allowed(owner))
      throw new Error('应用安装未授权：需在目标 Agent 本机明确启用并授权控制端指纹');
  }
  policySnapshot() { return structuredClone(this.policy); }
  async configure(input: unknown) {
    const policy = appPolicySchema.parse(input);
    await this.vault.write('applications-policy', policy);
    this.policy = policy;
    for (const entry of this.tasks.values()) {
      if (entry.task.state === 'running' && !this.allowed(entry.owner))
        this.active?.stop('授权已撤销');
    }
    return structuredClone(policy);
  }
  async list(owner: string) {
    const [detected, dockerProblem] = await Promise.all([
      this.manager(),
      nativeArch ? Promise.resolve('') : databaseHost(this.closing.signal).then(()=>'',error=>String(error.message).includes('ENOENT')?'请先安装并启动 Docker 和 Compose':String(error.message).slice(0,200)),
    ]);
    return {
      platform: process.platform,
      manager: detected?.manager ?? null,
      enabled: this.allowed(owner),
      applications: [...Object.entries(databaseRecipes).map(([id, recipe]) => ({id, package:nativeArch?nativeVersions[id as DatabaseApp]:recipe.name,...(dockerProblem?{unavailable:dockerProblem}:{})})), ...(detected
        ? Object.entries(recipes[detected.manager]).map(([id, pkg]) => ({ id, package: pkg }))
        : [])],
    };
  }
  private nativeRoot(app:DatabaseApp){return join(this.vault.storageDirectory,'database-apps',app);}
  private project(app: DatabaseApp) {
    const scope = createHash('sha256').update(this.vault.storageDirectory).digest('hex').slice(0,12);
    return 'cagent-' + app + '-' + scope;
  }
  private async savePlan(owner: string, task: Task) {
    this.authorize(owner);
    if (this.tasks.size >= 50) {
      const oldest = [...this.tasks].find(([, entry]) => entry.task.state !== 'running');
      if (oldest) this.tasks.delete(oldest[0]);
    }
    this.tasks.set(task.id,{owner,task});
    await this.persist();
    return structuredClone(task);
  }
  private manager() {
    this.closing.signal.throwIfAborted();
    return (this.checking ??= detectPackageManager().finally(() => {
      this.checking = undefined;
    }));
  }
  plan(input: unknown, owner: string, signal?: AbortSignal) {
    if (this.planning.size >= 4) return Promise.reject(new Error('安装检查繁忙，请稍后重试'));
    const pending = this.createPlan(input, owner, signal);
    this.planning.add(pending);
    void pending.finally(() => this.planning.delete(pending)).catch(() => {});
    return pending;
  }
  private async createPlan(input: unknown, owner: string, signal?: AbortSignal) {
    this.authorize(owner);
    const { app } = appPlanInput.parse(input);
    if (isDatabaseApp(app)) {
      const guard = signal ? AbortSignal.any([signal,this.closing.signal]) : this.closing.signal;
      let legacy=[...this.tasks.values()].some(({task})=>task.app===app && task.manager==='docker' && task.state==='completed');
      if(nativeArch && !legacy && !await nativePort(this.nativeRoot(app))){
        const socket=process.env.DOCKER_HOST?.startsWith('unix://')?process.env.DOCKER_HOST.slice(7):'/var/run/docker.sock';
        if(await access(socket).then(()=>true,()=>false)){
          const host=await databaseHost(guard).catch(()=>undefined);
          if(host)legacy=!!await databasePort(host,this.project(app),app,guard);
        }
      }
      if(nativeArch && !legacy){
        if(app==='milvus')await exec('dpkg-deb',['--version'],{signal:guard}).catch(()=>{throw Error('原生 Milvus 需要 dpkg-deb 解包工具，请在 Debian 或 Ubuntu 环境安装');});
        const root=this.nativeRoot(app),current=await nativePort(root);
        return this.savePlan(owner,{id:randomUUID(),app,manager:'native',executable:nativeVersions[app],args:[],platform:process.platform,
          port:current??databaseRecipes[app].port,expires:Date.now()+900000,state:'planned',exitCode:null,
          logs:'原生安装目录：'+root+(current?'，已配置端口 '+current:''),
          warning:(app==='milvus'?'Milvus 监听所选业务端口和内部 RPC 端口，请使用隔离的机器网络。启用账号认证；不会创建公网端口映射。':'数据库仅监听 127.0.0.1。')+' 原生安装，无需 Docker、systemd 或 sudo。换端口会短暂重启服务并保留数据。'});
      }
      const host = await databaseHost(guard);
      const current = await databasePort(host,this.project(app),app,guard);
      return this.savePlan(owner,{
        id:randomUUID(), app, manager:'docker', executable:'docker', args:[host], platform:process.platform,
        port:current ?? databaseRecipes[app].port, expires:Date.now()+900000, state:'planned',
        logs:current ? '已检测到此商城管理的实例，当前端口 '+current : '将创建独立容器和持久化数据卷',
        warning:'仅监听目标机器的 127.0.0.1。更换端口将重建容器并短暂中断连接，保留数据卷。优先使用缓存，其次尝试 DaoCloud 和 Docker Hub。',
      });
    }
    const detected = await this.manager();
    this.authorize(owner);
    if (!detected) throw new Error('未检测到支持的系统包管理器；不会自动安装或修改软件源');
    if ((detected.manager === 'apt-get' || detected.manager === 'dnf') && process.getuid?.() !== 0)
      throw new Error('系统包安装需要管理员运行 Agent；不会自动 sudo');
    if (detected.manager === 'brew' && process.getuid?.() === 0)
      throw new Error('Homebrew 必须由普通用户运行');
    const pkg = recipes[detected.manager][app];
    if (!pkg) throw new Error('该系统未提供此应用配方');
    const probe = detected.manager === 'apt-get' ? '/usr/bin/apt-cache' : detected.executable;
    const probeArgs =
      detected.manager === 'winget'
        ? ['show', '--id', pkg, '--exact', '--source', 'winget', '--disable-interactivity']
        : detected.manager === 'brew'
          ? ['info', ...(app === 'vscode' ? ['--cask'] : []), pkg]
          : [detected.manager === 'apt-get' ? 'show' : 'info', pkg];
    const metadata = app==='browser' ? {stdout:'安装 Google 官方 apt 软件源（独立签名密钥）、Chrome 稳定版、中文字体和无登录权限的 cagent-browser 用户。浏览器沙箱保持开启，资料保存在 /var/lib/cagent-browser；不开放网络端口。'} : await exec(probe, probeArgs, {
      windowsHide: true,
      timeout: 45000,
      maxBuffer: 65536,
      signal: signal ? AbortSignal.any([signal, this.closing.signal]) : this.closing.signal,
      env: { ...process.env, HOMEBREW_NO_AUTO_UPDATE: '1' },
    });
    this.authorize(owner);
    const task: Task = {
      id: randomUUID(),
      app,
      platform: process.platform,
      ...detected,
      ...(app==='browser'?{executable:'/bin/sh',args:['-c',linuxBrowserInstall]}:{args:installArgs(detected.manager,app)}),
      expires: Date.now() + 15 * 60_000,
      state: 'planned',
      logs: metadata.stdout.slice(-8192),
      warning: app==='browser' ? '将添加 Google 官方签名软件源，安装 Chrome、中文字体和浏览器专用用户。不会关闭沙箱或开放端口。取消后已安装的软件和资料保留。' :
        '执行会接受所列软件包和软件源协议，可能安装依赖或更新已有系统包。可能需要系统管理员批准；不会自动提权、重启或新增软件源。断线后任务继续；撤权会停止受管进程，但已安装部分及安装器子进程可能保留。',
    };
    return this.savePlan(owner, task);
  }
  private get(input: unknown, owner: string) {
    const { id } = appTaskInput.parse(input);
    const entry = this.tasks.get(id);
    if (!entry || entry.owner !== owner) throw new Error('NOT_FOUND');
    return entry.task;
  }
  status(input: unknown, owner: string) {
    this.authorize(owner);
    return structuredClone(this.get(input, owner));
  }
  async cancel(input: unknown, owner: string) {
    this.authorize(owner);
    const task = this.get(input, owner);
    if (task.state === 'running' && this.active?.task === task) this.active.stop('用户取消');
    if (task.state === 'planned') task.state = 'interrupted';
    await this.persist();
    return structuredClone(task);
  }
  /** Trusted package-lifecycle cleanup only. Ownership is checked even after a grant is revoked.
   * This is not exposed as a remote management operation. */
  async cancelAndWait(input: unknown, owner: string) {
    const task=this.get(input,owner),active=this.active?.task===task?this.active:undefined;
    if(active)active.stop('所属能力包正在停用');
    if(task.state==='planned')task.state='interrupted';
    if(active){
      let timer:ReturnType<typeof setTimeout>|undefined;
      try{await Promise.race([active.done,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('应用安装进程尚未退出，能力包不能完成卸载')),10000);})]);}
      finally{clearTimeout(timer);}
    }
    await this.persist();return structuredClone(task);
  }
  async install(input: unknown, owner: string) {
    const { id, port } = appInstallInput.parse(input);
    this.authorize(owner);
    const task = this.get({ id }, owner);
    // Same plan cannot submit twice, even if a reply was lost.
    if (task.state !== 'planned') return structuredClone(task);
    if (task.expires < Date.now()) throw new Error('安装计划已过期');
    if (this.active || this.starting) throw new Error('包管理器正忙，请等待当前安装完成');
    if (port !== undefined && !isDatabaseApp(task.app)) throw Error('此应用不支持端口设置');
    if (port !== undefined) task.port = port;
    this.starting = true;
    task.state = 'running';
    try { await this.persist(); } catch (error) { task.state='planned'; throw error; }
    finally { this.starting=false; }
    try {
      this.authorize(owner);
    } catch (error) {
      task.state = 'interrupted';
      await this.persist();
      throw error;
    }
    if (isDatabaseApp(task.app)) {
      const controller = new AbortController();
      const stop = (reason: string) => controller.abort(new Error(reason));
      const log = (line: string) => { task.logs=(task.logs+'\n'+line).slice(-32768); };
      const check=setInterval(()=>{if(!this.allowed(owner))stop('安装授权已撤销');},500);
      const done=(task.manager==='native' ? installNative(this.nativeRoot(task.app),task.app,task.port!,controller.signal,log) : installDatabase(task.args[0],this.project(task.app),task.app,task.port!,controller.signal,log))
        .then(()=>{task.state='completed';task.exitCode=0;})
        .catch(error=>{task.state=controller.signal.aborted?'interrupted':'failed';log(String(controller.signal.reason??error));})
        .finally(async()=>{clearInterval(check);try{await this.persist();}finally{this.active=undefined;}});
      this.active={task,done,stop};
      void done.catch(()=>{task.state='interrupted';log('任务状态保存失败');});
      return structuredClone(task);
    }
    const child = spawn(task.executable, task.args, {
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        DEBIAN_FRONTEND: 'noninteractive',
        HOMEBREW_NO_AUTO_UPDATE: '1',
        HOMEBREW_NO_INSTALL_UPGRADE: '1',
      },
    });
    let finish!: () => void;
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const append = (text: string) => {
      task.logs = (task.logs + text).slice(-32768);
    };
    const stop = (reason: string) => {
      if (task.state !== 'running') return;
      task.state = 'interrupted';
      append('\n' + reason + '；安装结果可能不完整，请检查系统。');
      child.kill();
    };
    this.active = { child, task, done, stop };
    const timer = setTimeout(() => stop('安装超过 15 分钟'), 15 * 60_000);
    const grantTimer = setInterval(() => {
      if (!this.allowed(owner)) stop('授权已撤销');
    }, 1000);
    child.stdout?.on('data', (data: Buffer) => append(data.toString('utf8')));
    child.stderr?.on('data', (data: Buffer) => append(data.toString('utf8')));
    child.once('error', () => {
      task.state = 'failed';
      append('\n无法启动包管理器');
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      clearInterval(grantTimer);
      task.exitCode = code;
      if (task.state === 'running') task.state = code === 0 ? 'completed' : 'failed';
      void this.persist()
        .catch(() => {
          task.state = 'interrupted';
          append('\n结果保存失败');
        })
        .finally(() => {
          this.active = undefined;
          finish();
        });
    });
    return structuredClone(task);
  }
  async dispose() {
    this.closing.abort();
    await Promise.allSettled(this.planning);
    this.active?.stop('Agent 正在退出');
    await this.active?.done;
    await this.writes;
  }
}
