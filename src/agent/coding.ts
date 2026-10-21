import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdir, stat, readFile, writeFile } from 'node:fs/promises';
import { join, dirname, isAbsolute, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { z } from 'zod';
import type { ClientVault } from '../core/client/identity';
import {
  codingEngine,
  codingProfileSchema,
  type CodingEngine,
  type CodingProfile,
  type CodingTask,
} from '../shared/coding';
const configSchema = z.object({
  codex: z.string().default(''),
  claude: z.string().default(''),
  directory: z.string(),
});
const savedSchema = z.object({
  profiles: z.array(codingProfileSchema.extend({ owner: z.string() })),
  tasks: z.array(z.any()),
});
const pkg = { codex: '@openai/codex', claude: '@anthropic-ai/claude-code' };
const entry = { codex: 'bin/codex.js', claude: 'cli.js' };
const object = z.object({ id: z.string().uuid() }).strict();
export class CodingRpc {
  private next = 0;
  private pending = new Map<
    number,
    { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();
  private buffer = '';
  constructor(
    readonly child: ChildProcessWithoutNullStreams,
    private event: (v: any) => void,
  ) {
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (s: string) => {
      this.buffer += s;
      if (this.buffer.length > 4_000_000) {
        this.fail(Error('引擎输出过大'));
        child.kill();
        return;
      }
      let i;
      while ((i = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, i);
        this.buffer = this.buffer.slice(i + 1);
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id !== undefined && !msg.method) {
            const p = this.pending.get(msg.id);
            if (p) {
              clearTimeout(p.timer);
              this.pending.delete(msg.id);
              msg.error ? p.reject(Error(msg.error.message)) : p.resolve(msg.result);
            }
          } else this.event(msg);
        } catch {
          this.fail(Error('引擎返回无效 JSON'));
          child.kill();
        }
      }
    });
    child.on('error', (e) => this.fail(e));
    child.on('close', () => this.fail(Error('引擎进程已退出')));
  }
  private fail(e: Error) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(e);
    }
    this.pending.clear();
  }
  send(v: unknown) {
    if (this.child.stdin.destroyed) throw Error('引擎已关闭');
    this.child.stdin.write(JSON.stringify(v) + '\n');
  }
  request(method: string, params: unknown = {}) {
    const id = ++this.next;
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Error('引擎请求超时：' + method));
      }, 45000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ id, method, params });
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }
  async initialize() {
    await this.request('initialize', {
      clientInfo: { name: 'cshell', title: 'CShell', version: '1.0' },
      capabilities: {},
    });
    this.send({ method: 'initialized' });
  }
}
type Login = {
  id: string;
  owner: string;
  profileId: string;
  state: string;
  url?: string;
  code?: string;
  error?: string;
  output: string;
  child?: ChildProcessWithoutNullStreams;
  rpc?: CodingRpc;
  timer?: NodeJS.Timeout;
};
export class CodingService {
  private saveTimer?: NodeJS.Timeout;
  private scheduleSave() {
    if (!this.saveTimer)
      this.saveTimer = setTimeout(() => {
        this.saveTimer = undefined;
        void this.persist().catch(() => {});
      }, 250);
  }
  private config: z.infer<typeof configSchema>;
  private profiles: (CodingProfile & { owner: string })[] = [];
  private tasks: CodingTask[] = [];
  private running = new Map<
    string,
    {
      child: ChildProcessWithoutNullStreams;
      rpc?: CodingRpc;
      turnId?: string;
      profile: CodingProfile;
      timer?: NodeJS.Timeout;
    }
  >();
  private logins = new Map<string, Login>();
  private plans = new Map<
    string,
    { owner: string; engine: CodingEngine; directory: string; version: string; npm: string }
  >();
  private installJobs = new Map<
    string,
    {
      id: string;
      owner: string;
      state: string;
      output: string;
      child?: ChildProcessWithoutNullStreams;
    }
  >();
  constructor(
    private vault: ClientVault,
    directory: string,
    private allowed: (owner: string) => boolean,
  ) {
    this.config = { codex: '', claude: '', directory: join(directory, 'coding') };
  }
  async load() {
    this.config = (await this.vault.read('coding-config', configSchema)) ?? this.config;
    const saved = await this.vault.read('coding-state', savedSchema);
    if (saved) {
      this.profiles = saved.profiles;
      this.tasks = saved.tasks.map((t) => ({
        ...t,
        approval: undefined,
        state: ['stopping', 'running', 'approval'].includes(t.state) ? 'interrupted' : t.state,
      }));
    }
  }
  private authorize(owner: string) {
    if (!this.allowed(owner)) throw Error('编程智能体未获机器管理与命令权限');
  }
  private persist() {
    for (const t of this.tasks) {
      while (t.messages.length > 2 && t.messages.reduce((n, m) => n + m.text.length, 0) > 400000)
        t.messages.shift();
    }
    return this.vault.write('coding-state', {
      profiles: this.profiles,
      tasks: this.tasks.slice(-100),
    });
  }
  private profile(owner: string, id: string) {
    const p = this.profiles.find((p) => p.owner === owner && p.id === id);
    if (!p) throw Error('基座不存在');
    return p;
  }
  private task(owner: string, id: string) {
    const t = this.tasks.find((t) => t.owner === owner && t.id === id);
    if (!t) throw Error('会话不存在');
    return t;
  }
  private home(p: CodingProfile, owner: string) {
    return join(
      this.config.directory,
      'accounts',
      createHash('sha256').update(owner).digest('hex').slice(0, 24),
      p.id,
    );
  }
  private executable(engine: CodingEngine) {
    return (
      this.config[engine] ||
      join(this.config.directory, 'engines', engine, 'node_modules', pkg[engine], entry[engine])
    );
  }
  private env(p: CodingProfile, owner: string) {
    const env = { ...process.env };
    delete env.CSHELL_CODING_API_KEY;
    for (const k of Object.keys(env))
      if (/^(OPENAI_|ANTHROPIC_|CLAUDE_CODE_|CODEX_)/.test(k)) delete env[k];
    env.CODEX_HOME = this.home(p, owner);
    env.CLAUDE_CONFIG_DIR = this.home(p, owner);
    env.DISABLE_AUTOUPDATER = '1';
    if (p.auth === 'api') {
      if (!p.key) throw Error('请配置 API Key');
      if (p.engine === 'codex') env.CSHELL_CODING_API_KEY = p.key;
      else {
        env.ANTHROPIC_API_KEY = p.key;
        env.ANTHROPIC_BASE_URL = p.endpoint;
      }
    }
    return env;
  }
  private async launch(p: CodingProfile, owner: string, args: string[], cwd: string) {
    this.authorize(owner);
    if (!['linux', 'win32', 'darwin'].includes(process.platform))
      throw Error('此平台尚未验证官方编程引擎');
    await mkdir(this.home(p, owner), { recursive: true, mode: 0o700 });
    const exe = this.executable(p.engine);
    await stat(exe);
    const js = /\.[cm]?js$/i.test(exe);
    return spawn(js ? process.execPath : exe, js ? [exe, ...args] : args, {
      cwd,
      env: this.env(p, owner),
      stdio: 'pipe',
      windowsHide: true,
      detached: process.platform !== 'win32',
    });
  }
  private async probe(engine: CodingEngine) {
    try {
      const exe = this.executable(engine);
      await stat(exe);
      const js = /\.[cm]?js$/i.test(exe);
      return await new Promise<{ ready: boolean; version?: string; reason?: string }>((done) => {
        const child = spawn(js ? process.execPath : exe, js ? [exe, '--version'] : ['--version'], {
          windowsHide: true,
          stdio: 'pipe',
        });
        let out = '';
        const timer = setTimeout(() => {
          child.kill();
          done({ ready: false, reason: '版本检查超时' });
        }, 8000);
        child.stdout.on('data', (b) => (out = (out + b).slice(0, 1000)));
        child.on('error', (e) => {
          clearTimeout(timer);
          done({ ready: false, reason: e.message });
        });
        child.on('close', (code) => {
          clearTimeout(timer);
          done(
            code === 0
              ? { ready: true, version: out.trim() }
              : { ready: false, reason: '版本检查失败' },
          );
        });
      });
    } catch {
      return { ready: false, reason: '尚未安装或路径不可用' };
    }
  }
  private clean(p: CodingProfile, text: string) {
    return (p.key ? text.split(p.key).join('[已隐藏密钥]') : text).slice(-200000);
  }
  private event(t: CodingTask, p: CodingProfile, kind: string, text: string) {
    t.events.push({ kind, text: this.clean(p, text).slice(-8000) });
    if (t.events.length > 60) t.events.shift();
  }
  private kill(child: ChildProcessWithoutNullStreams) {
    if (child.exitCode !== null || child.signalCode) return;
    if (process.platform === 'win32') {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
      });
      killer.on('error', () => child.kill());
    } else
      try {
        process.kill(-child.pid!, 'SIGTERM');
        const timer = setTimeout(() => {
          try {
            process.kill(-child.pid!, 'SIGKILL');
          } catch {}
        }, 2000);
        timer.unref();
      } catch {
        child.kill();
      }
  }
  private async npmPath() {
    const candidates = [
      join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
      join(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'),
      join(dirname(process.execPath), '../share/nodejs/npm/bin/npm-cli.js'),
      ...(process.env.PATH ?? '')
        .split(process.platform === 'win32' ? ';' : ':')
        .flatMap((p) => [
          join(p, 'node_modules/npm/bin/npm-cli.js'),
          join(p, '../lib/node_modules/npm/bin/npm-cli.js'),
          join(p, '../share/nodejs/npm/bin/npm-cli.js'),
        ]),
    ];
    try {
      candidates.unshift(createRequire(import.meta.url).resolve('npm/bin/npm-cli.js'));
    } catch {}
    for (const p of candidates)
      try {
        await stat(p);
        return resolve(p);
      } catch {}
    throw Error('未找到 npm。请选择已有官方客户端的可执行文件；不会安装系统依赖。');
  }
  async call(method: string, raw: unknown, owner: string): Promise<any> {
    this.authorize(owner);
    if (method === 'coding.status')
      return {
        platform: process.platform,
        directory: this.config.directory,
        engines: await Promise.all(
          (['codex', 'claude'] as const).map(async (engine) => ({
            engine,
            path: this.executable(engine),
            ...(await this.probe(engine)),
          })),
        ),
        profiles: this.profiles
          .filter((p) => p.owner === owner)
          .map(({ key, owner, ...p }) => ({ ...p, hasKey: !!key })),
        installs: [...this.installJobs.values()]
          .filter((j) => j.owner === owner)
          .map(({ child, owner, ...j }) => j),
      };
    if (method === 'coding.configure') {
      const c = configSchema.parse(raw);
      if (!isAbsolute(c.directory) || [c.codex, c.claude].some((p) => p && !isAbsolute(p)))
        throw Error('请使用绝对路径');
      if (this.running.size || [...this.logins.values()].some((l) => l.state === 'running'))
        throw Error('请先停止任务和登录流程');
      this.config = c;
      await this.vault.write('coding-config', c);
      return { saved: true };
    }
    if (method === 'coding.profile.save') {
      const input = codingProfileSchema.parse(raw),
        old = this.profiles.find((p) => p.id === input.id);
      if (old && old.owner !== owner) throw Error('基座不属于当前控制端');
      if (
        [...this.logins.values()].some((l) => l.profileId === input.id && l.state === 'running') ||
        (this.running.size && [...this.running.values()].some((r) => r.profile.id === input.id))
      )
        throw Error('此基座有运行中的任务，请新建基座或等待结束');
      const p = {
        ...input,
        key: input.auth === 'official' ? undefined : (input.key ?? old?.key),
        owner,
      };
      if (p.auth === 'api' && !p.key) throw Error('请填写 API Key');
      if (!old && this.profiles.length >= 64) throw Error('基座数量已达上限');
      this.profiles = this.profiles.filter((p) => p.id !== input.id);
      this.profiles.push(p);
      await this.persist();
      return { saved: true };
    }
    if (method === 'coding.profile.remove') {
      const { id } = object.parse(raw);
      this.profile(owner, id);
      if (
        [...this.running.values()].some((r) => r.profile.id === id) ||
        [...this.logins.values()].some((l) => l.profileId === id && l.state === 'running')
      )
        throw Error('基座正在使用');
      this.profiles = this.profiles.filter((p) => p.id !== id);
      await this.persist();
      return { removed: true };
    }
    if (method === 'coding.install.plan') {
      const p = z.object({ engine: codingEngine, directory: z.string() }).strict().parse(raw);
      if (!isAbsolute(p.directory)) throw Error('安装目录须为绝对路径');
      const npm = await this.npmPath();
      const response = await fetch('https://registry.npmjs.org/' + pkg[p.engine] + '/latest', {
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw Error('官方软件包目录查询失败');
      const metadata = (await response.json()) as { version: string };
      if (!/^\d+\.\d+\.\d+[-\w.]*$/.test(metadata.version)) throw Error('软件包版本无效');
      const id = randomUUID(),
        plan = {
          owner,
          engine: p.engine,
          directory: resolve(p.directory),
          version: metadata.version,
          npm,
        };
      if (this.plans.size >= 20) this.plans.clear();
      this.plans.set(id, plan);
      return {
        id,
        engine: p.engine,
        version: plan.version,
        directory: join(plan.directory, 'engines', p.engine),
        steps: [
          '在专用目录安装官方 npm 软件包及依赖',
          '禁用安装脚本，不修改全局 PATH 或系统软件源',
          '安装后验证实际客户端版本',
        ],
      };
    }
    if (method === 'coding.install.cancel') {
      const { id } = object.parse(raw),
        job = this.installJobs.get(id);
      if (!job || job.owner !== owner) throw Error('安装任务不存在');
      if (job.state === 'running' && job.child) {
        job.state = 'cancelled';
        this.kill(job.child);
      }
      return { state: job.state };
    }
    if (method === 'coding.install') {
      const { id } = object.parse(raw),
        plan = this.plans.get(id);
      if (!plan || plan.owner !== owner) throw Error('安装计划已过期');
      if ([...this.installJobs.values()].some((j) => j.state === 'running'))
        throw Error('已有安装任务');
      this.plans.delete(id);
      const prefix = join(plan.directory, 'engines', plan.engine);
      await mkdir(prefix, { recursive: true });
      const job = {
        id: randomUUID(),
        owner,
        state: 'running',
        output: '',
        child: undefined as ChildProcessWithoutNullStreams | undefined,
      };
      this.installJobs.set(job.id, job);
      const npmConfig = join(plan.directory, 'npm-isolated.conf');
      await writeFile(npmConfig, '', { mode: 0o600 });
      await writeFile(npmConfig+'.global', '', { mode: 0o600 });
      const npmEnv = Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !/^npm_/i.test(key)),
      );
      const child = spawn(
        process.execPath,
        [
          plan.npm,
          'install',
          '--prefix',
          prefix,
          '--no-audit',
          '--no-fund',
          '--ignore-scripts',
          '--registry=https://registry.npmjs.org',
          pkg[plan.engine] + '@' + plan.version,
        ],
        {
          windowsHide: true,
          detached: process.platform !== 'win32',
          env: {
            ...npmEnv,
            npm_config_cache: join(plan.directory, 'cache'),
            npm_config_userconfig: npmConfig,
            npm_config_globalconfig: npmConfig+'.global',
          },
          stdio: 'pipe',
        },
      );
      job.child = child;
      const timer = setTimeout(() => this.kill(child), 10 * 60000);
      child.stdout.on('data', (b) => (job.output = (job.output + b).slice(-12000)));
      child.stderr.on('data', (b) => (job.output = (job.output + b).slice(-12000)));
      child.on('error', (e) => {
        job.state = 'failed';
        job.output = e.message;
        clearTimeout(timer);
      });
      child.on('close', async (code) => {
        clearTimeout(timer);
        if (job.state === 'cancelled') return;
        job.state = 'failed';
        if (code === 0) {
          this.config[plan.engine] = join(
            prefix,
            'node_modules',
            pkg[plan.engine],
            entry[plan.engine],
          );
          await this.vault.write('coding-config', this.config);
          const result = await this.probe(plan.engine);
          job.state =
            result.ready && result.version?.includes(plan.version) ? 'completed' : 'failed';
          if (!result.ready) job.output += '\n' + result.reason;
        }
      });
      return { id: job.id };
    }
    if (method === 'coding.tasks')
      return this.tasks
        .filter((t) => t.owner === owner)
        .map(({ owner, messages, events, approval, ...t }) => ({
          ...t,
          preview: messages.at(-1)?.text.slice(0, 200),
        }));
    if (method === 'coding.task') return structuredClone(this.task(owner, object.parse(raw).id));
    if (method === 'coding.start') return this.start(raw, owner);
    if (method === 'coding.stop') {
      const t = this.task(owner, object.parse(raw).id),
        r = this.running.get(t.id);
      if (r) {
        t.state = 'stopping';
        t.approval = undefined;
        this.kill(r.child);
      }
      await this.persist();
      return { state: t.state };
    }
    if (method === 'coding.approve') {
      const p = z
          .object({ id: z.string().uuid(), approvalId: z.string(), accept: z.boolean() })
          .strict()
          .parse(raw),
        t = this.task(owner, p.id),
        r = this.running.get(t.id);
      if (!t.approval || t.approval.id !== p.approvalId || !r?.rpc) throw Error('审批已失效');
      r.rpc.send({
        id: JSON.parse(t.approval.id),
        result: { decision: p.accept ? 'accept' : 'decline' },
      });
      t.approval = undefined;
      t.state = 'running';
      await this.persist();
      return { saved: true };
    }
    if (method === 'coding.login') return this.login(raw, owner);
    if (method.startsWith('coding.login.')) {
      const p = z
          .object({ id: z.string().uuid(), text: z.string().max(4096).optional() })
          .strict()
          .parse(raw),
        l = this.logins.get(p.id);
      if (!l || l.owner !== owner) throw Error('登录流程不存在');
      if (method === 'coding.login.cancel') {
        if (l.child) this.kill(l.child);
        l.state = 'cancelled';
        if (l.timer) clearTimeout(l.timer);
      }
      if (method === 'coding.login.input') {
        if (l.state !== 'running' || !l.child || !p.text) throw Error('当前登录不接受输入');
        l.child.stdin.write(p.text + '\n');
      }
      const { child, rpc, timer, owner: loginOwner, ...result } = l;
      return result;
    }
    throw Error('未知编程操作');
  }
  private codexArgs(p: CodingProfile) {
    const args = ['app-server'];
    if (p.auth === 'api')
      args.push(
        '-c',
        'model_provider="cshell"',
        '-c',
        'model_providers.cshell.name="CShell"',
        '-c',
        'model_providers.cshell.base_url=' + JSON.stringify(p.endpoint),
        '-c',
        'model_providers.cshell.env_key="CSHELL_CODING_API_KEY"',
        '-c',
        'model_providers.cshell.wire_api="responses"',
      );
    return args;
  }
  private async start(raw: unknown, owner: string) {
    const i = z
        .object({
          profileId: z.string().uuid(),
          cwd: z.string().min(1).max(4096),
          prompt: z.string().trim().min(1).max(64000),
          resumeId: z.string().uuid().optional(),
          mode: z.enum(['read', 'edit', 'execute']).default('read'),
        })
        .strict()
        .parse(raw),
      p = { ...this.profile(owner, i.profileId) };
    if (this.running.size >= 4) throw Error('最多同时运行 4 项任务');
    if (!isAbsolute(i.cwd) || !(await stat(i.cwd)).isDirectory()) throw Error('项目目录不存在');
    const binding = createHash('sha256')
      .update(JSON.stringify([p.engine, p.auth, p.endpoint, p.model]))
      .digest('hex');
    let t: CodingTask;
    if (i.resumeId) {
      t = this.task(owner, i.resumeId);
      if (this.running.has(t.id)) throw Error('任务正在执行');
      if (
        t.profileId !== p.id ||
        t.cwd !== i.cwd ||
        (t.profileBinding && t.profileBinding !== binding)
      )
        throw Error('切换基座或项目请新建会话');
    } else {
      t = {
        id: randomUUID(),
        owner,
        engine: p.engine,
        profileId: p.id,
        profileName: p.name,
        profileBinding: binding,
        cwd: i.cwd,
        title: i.prompt.slice(0, 80),
        state: 'running',
        messages: [],
        events: [],
        createdAt: new Date().toISOString(),
      };
      this.tasks.push(t);
    }
    t.state = 'running';
    t.error = undefined;
    t.messages.push({ role: 'user', text: i.prompt });
    await this.persist();
    const args =
      p.engine === 'codex'
        ? this.codexArgs(p)
        : [
            '-p',
            '--output-format',
            'stream-json',
            '--verbose',
            '--permission-mode',
            i.mode === 'read' ? 'plan' : 'acceptEdits',
            ...(i.mode === 'execute' ? ['--allowedTools', 'Read,Glob,Grep,Edit,Write,Bash'] : []),
            ...(p.model ? ['--model', p.model] : []),
            ...(t.threadId ? ['--resume', t.threadId] : []),
          ];
    let child: ChildProcessWithoutNullStreams;
    try {
      child = await this.launch(p, owner, args, i.cwd);
    } catch (e) {
      t.state = 'failed';
      t.error = String(e);
      await this.persist();
      throw e;
    }
    const r = {
      child,
      profile: p,
      rpc: undefined as CodingRpc | undefined,
      turnId: undefined as string | undefined,
      timer: undefined as NodeJS.Timeout | undefined,
    };
    this.running.set(t.id, r);
    r.timer = setInterval(() => {
      if (!this.allowed(owner)) {
        t.error = '执行权限已撤销';
        this.kill(child);
      }
    }, 1000);
    const finish = async (code: number | null) => {
      if (r.timer) clearInterval(r.timer);
      this.running.delete(t.id);
      t.approval = undefined;
      if (t.state === 'stopping') t.state = 'cancelled';
      if (['running', 'approval'].includes(t.state)) t.state = 'failed';
      if (t.state === 'failed' && !t.error) t.error = '引擎退出：' + code;
      await this.persist();
    };
    child.on('error', (e) => {
      t.error = this.clean(p, e.message);
    });
    child.on('close', (code) => void finish(code));
    child.stderr.on('data', (b) => {
      this.event(t, p, 'stderr', b.toString());
    });
    if (p.engine === 'codex') {
      const rpc = new CodingRpc(child, (msg) => {
        const v = msg.params ?? {};
        if (msg.id !== undefined && msg.method) {
          if (
            ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(
              msg.method,
            )
          ) {
            if (t.approval) {
              rpc.send({ id: msg.id, result: { decision: 'decline' } });
              return;
            }
            t.approval = {
              id: JSON.stringify(msg.id),
              method: msg.method,
              details: JSON.parse(this.clean(p, JSON.stringify(v))),
            };
            t.state = 'approval';
            this.scheduleSave();
          } else
            rpc.send({ id: msg.id, error: { code: -32601, message: 'CShell 尚不支持此交互' } });
          return;
        }
        if (msg.method === 'turn/started') r.turnId = v.turn?.id;
        if (msg.method === 'item/agentMessage/delta') {
          let m = t.messages.at(-1);
          if (m?.role !== 'assistant') {
            m = { role: 'assistant', text: '' };
            t.messages.push(m);
          }
          m.text = this.clean(p, m.text + v.delta);
        } else if (msg.method === 'turn/completed') {
          t.state = v.turn?.status === 'failed' ? 'failed' : 'completed';
          t.error = v.turn?.error?.message;
          child.stdin.end();
          this.kill(child);
        } else if (msg.method === 'turn/diff/updated') this.event(t, p, 'diff', v.diff ?? '');
        else if (msg.method === 'item/completed')
          this.event(t, p, v.item?.type ?? '工具', JSON.stringify(v.item));
        void this.persist();
      });
      r.rpc = rpc;
      void (async () => {
        try {
          await rpc.initialize();
          const thread = await rpc.request(t.threadId ? 'thread/resume' : 'thread/start', {
            ...(t.threadId ? { threadId: t.threadId } : {}),
            cwd: i.cwd,
            ...(p.model ? { model: p.model } : {}),
            approvalPolicy: 'on-request',
            sandbox: i.mode === 'read' ? 'read-only' : 'workspace-write',
          });
          t.threadId = thread.thread.id;
          await rpc.request('turn/start', {
            threadId: t.threadId,
            input: [{ type: 'text', text: i.prompt }],
          });
          await this.persist();
        } catch (e) {
          if (!['stopping', 'cancelled', 'completed'].includes(t.state)) {
            t.error = this.clean(p, String(e));
            t.state = 'failed';
          }
          this.kill(child);
        }
      })();
    } else {
      let buffer = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (s: string) => {
        buffer += s;
        if (buffer.length > 4_000_000) {
          t.error = '引擎输出过大';
          this.kill(child);
          return;
        }
        let end;
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 1);
          try {
            const m = JSON.parse(line);
            if (m.session_id) t.threadId = m.session_id;
            if (m.type === 'assistant')
              for (const b of m.message?.content ?? []) {
                if (b.type === 'text')
                  t.messages.push({ role: 'assistant', text: this.clean(p, b.text) });
                else if (b.type === 'tool_use') this.event(t, p, b.name, JSON.stringify(b.input));
              }
            if (m.type === 'result') {
              t.state = m.is_error ? 'failed' : 'completed';
              if (m.is_error) t.error = this.clean(p, m.result ?? JSON.stringify(m.errors));
              if (
                m.result &&
                !t.messages.some((v) => v.role === 'assistant' && v.text === m.result)
              )
                t.messages.push({ role: 'assistant', text: this.clean(p, m.result) });
            }
            void this.persist();
          } catch {
            this.event(t, p, 'output', line);
          }
        }
      });
      child.stdin.end(i.prompt);
    }
    return { id: t.id };
  }
  private async login(raw: unknown, owner: string) {
    const { id } = object.parse(raw),
      p = this.profile(owner, id);
    if (p.auth !== 'official') throw Error('API 基座请填写密钥');
    if ([...this.logins.values()].some((l) => l.owner === owner && l.state === 'running'))
      throw Error('已有登录流程');
    const l: Login = { id: randomUUID(), owner, profileId: p.id, state: 'running', output: '' };
    if (this.logins.size >= 20) {
      for (const [key, item] of this.logins) if (item.state !== 'running') this.logins.delete(key);
    }
    this.logins.set(l.id, l);
    try {
      if (p.engine === 'codex') {
        const child = await this.launch(p, owner, this.codexArgs(p), this.config.directory);
        l.child = child;
        const rpc = new CodingRpc(child, (m) => {
          if (m.method === 'account/login/completed') {
            l.state = m.params.success ? 'completed' : 'failed';
            l.error = m.params.error;
            if (l.timer) clearTimeout(l.timer);
            this.kill(child);
          }
        });
        l.rpc = rpc;
        await rpc.initialize();
        const result = await rpc.request('account/login/start', { type: 'chatgpt' });
        l.url = result.authUrl;
      } else {
        const home = this.home(p, owner);
        await mkdir(home, { recursive: true });
        const capture = join(home, 'browser-url.txt'),
          script = join(home, 'capture-browser.cjs'),
          launcher = join(home, process.platform === 'win32' ? 'browser.cmd' : 'browser');
        await writeFile(
          script,
          "require('fs').writeFileSync(" +
            JSON.stringify(capture) +
            ",process.argv.slice(2).find(s=>/^https:\\/\\//.test(s))||'')",
        );
        const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
        await writeFile(
          launcher,
          process.platform === 'win32'
            ? '@echo off\r\n"' + process.execPath + '" "' + script + '" %*\r\n'
            : '#!/bin/sh\nexec ' + quote(process.execPath) + ' ' + quote(script) + ' "$@"\n',
          { mode: 0o700 },
        );
        await writeFile(capture, '');
        const exe = this.executable('claude'),
          js = /\.[cm]?js$/i.test(exe);
        const child = spawn(
          js ? process.execPath : exe,
          js ? [exe, 'auth', 'login'] : ['auth', 'login'],
          {
            env: { ...this.env(p, owner), BROWSER: launcher },
            cwd: home,
            windowsHide: true,
            stdio: 'pipe',
            detached: process.platform !== 'win32',
          },
        );
        l.child = child;
        const output = (b: Buffer) => {
          l.output = (l.output + b.toString()).slice(-12000);
          const url = l.output.match(/https:\/\/[^\s\x1b]+/g)?.find((u) => this.loginUrl(u));
          if (url) l.url = url;
        };
        child.stdout.on('data', output);
        child.stderr.on('data', output);
        const poll = setInterval(() => {
          void readFile(capture, 'utf8')
            .then((u) => {
              if (this.loginUrl(u)) l.url = u;
            })
            .catch(() => {});
        }, 500);
        child.once('close', (code) => {
          clearInterval(poll);
          if (l.timer) clearTimeout(l.timer);
          if (l.state === 'running') l.state = code === 0 ? 'completed' : 'failed';
        });
        child.on('error', (e) => {
          l.state = 'failed';
          l.error = e.message;
          clearInterval(poll);
        });
      }
      const authorization = setInterval(() => {
        if (!this.allowed(owner)) {
          l.state = 'failed';
          l.error = '登录权限已撤销';
          if (l.child) this.kill(l.child);
        }
      }, 1000);
      l.child?.once('close', () => clearInterval(authorization));
      l.timer = setTimeout(() => {
        l.state = 'failed';
        l.error = '登录等待超时';
        if (l.child) this.kill(l.child);
      }, 10 * 60000);
      return { id: l.id, url: l.url, state: l.state };
    } catch (e) {
      l.state = 'failed';
      l.error = String(e);
      if (l.child) this.kill(l.child);
      throw e;
    }
  }
  private loginUrl(s: string) {
    try {
      const u = new URL(s);
      return (
        u.protocol === 'https:' &&
        [
          'claude.ai',
          'platform.claude.com',
          'console.anthropic.com',
          'auth.anthropic.com',
        ].includes(u.hostname)
      );
    } catch {
      return false;
    }
  }
  async close() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    for (const r of this.running.values()) this.kill(r.child);
    for (const l of this.logins.values()) {
      if (l.child) this.kill(l.child);
      if (l.timer) clearTimeout(l.timer);
    }
    for (const j of this.installJobs.values()) if (j.child) this.kill(j.child);
    await this.persist();
  }
}
