import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { posix } from 'node:path';
import type { SshService } from './ssh';
import { RemoteJobs, quote } from './remote-jobs';
import {
  linuxInstallProbe,
  linuxNodeRuntime,
  linuxWorkspaceInstallScript,
} from './linux-workspace-install';
import { agentCallSchema, type AgentCall } from '../shared/agent';
import type { LinuxWorkspacePlan } from '../shared/linux-workspace';

export const linuxWorkspaceLauncher = '"$HOME/.local/share/cagent/cshell/current/cagent"';
import { linuxWorkspaceMethods } from '../shared/linux-workspace';

// Management uses an independent persistent SSH channel. It never types into a shell
// or reads credentials; the existing verified SSH session is the transport.
export class LinuxWorkspaceService {
  readonly jobs: RemoteJobs;
  private bridges = new Map<
    string,
    Promise<{ request: (call: AgentCall, signal?: AbortSignal) => Promise<unknown> }>
  >();
  private bridge(session: string) {
    this.ssh.get(session);
    let cached = this.bridges.get(session);
    if (cached) return cached;
    const pending = new Promise<{
      request: (call: AgentCall, signal?: AbortSignal) => Promise<unknown>;
    }>((resolve, reject) => {
      this.ssh.get(session).client.exec(linuxWorkspaceLauncher + ' bridge', (error, channel) => {
        if (error) {
          reject(error);
          return;
        }
        let buffer = '';
        const requests = new Map<
          string,
          { resolve: (v: unknown) => void; reject: (e: Error) => void; finish: () => void }
        >();
        const fail = () => {
          this.bridges.delete(session);
          for (const p of requests.values()) {
            p.finish();
            p.reject(new Error('CAgent 通道已断开；操作未重放'));
          }
          requests.clear();
        };
        channel.on('error', fail);
        channel.once('close', fail);
        channel.stderr.on('data', () => {});
        channel.setEncoding('utf8');
        channel.on('data', (chunk: string) => {
          buffer += chunk;
          if (buffer.length > 3 * 1024 * 1024) {
            channel.close();
            fail();
            return;
          }
          let end: number;
          while ((end = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, end);
            buffer = buffer.slice(end + 1);
            try {
              const result = JSON.parse(line),
                p = requests.get(result.id);
              if (p) {
                requests.delete(result.id);
                p.finish();
                result.error ? p.reject(new Error(result.error)) : p.resolve(result.result);
              }
            } catch {
              channel.close();
              fail();
            }
          }
        });
        resolve({
          request: (call, signal) =>
            new Promise((res, rej) => {
              if (channel.destroyed || requests.size >= 8) {
                rej(new Error('CAgent 通道忙或已关闭'));
                return;
              }
              const id = randomUUID(),
                cancel = () => {
                  requests.delete(id);
                  clearTimeout(timer);
                  signal?.removeEventListener('abort', cancel);
                  rej(new Error('操作已取消；远端结果可能未知'));
                },
                timer = setTimeout(() => {
                  requests.delete(id);
                  signal?.removeEventListener('abort', cancel);
                  rej(new Error('CAgent 操作超时；未重放'));
                }, 60000);
              if (signal?.aborted) {
                cancel();
                return;
              }
              signal?.addEventListener('abort', cancel, { once: true });
              requests.set(id, {
                resolve: res,
                reject: rej,
                finish: () => {
                  clearTimeout(timer);
                  signal?.removeEventListener('abort', cancel);
                },
              });
              channel.write(JSON.stringify({ id, call }) + '\n');
            }),
        });
      });
    });
    this.bridges.set(session, pending);
    void pending.catch(() => this.bridges.delete(session));
    return pending;
  }
  private plans = new Map<string, { session: string; expires: number; plan: LinuxWorkspacePlan }>();
  constructor(
    private ssh: SshService,
    private payload: string,
  ) {
    this.jobs = new RemoteJobs(ssh);
  }
  validate(session: string) {
    this.ssh.get(session);
  }
  async plan(session: string, directory?: string) {
    this.ssh.get(session);
    if (
      directory !== undefined &&
      (typeof directory !== 'string' ||
        directory.length > 1024 ||
        !directory.startsWith('/') ||
        /[\r\n\0]/.test(directory) ||
        directory.split('/').includes('..') ||
        posix.normalize(directory) === '/')
    )
      throw new Error('请选择专用的绝对路径，例如 /data/cagent；不能使用根目录或 ..');
    if (directory) directory = posix.normalize(directory).replace(/\/+$/, '');
    const output = await this.jobs.exec(session, linuxInstallProbe);
    const [platform, arch, user, state, node, npm, ...missing] = output.trim().split(/\r?\n/);
    if (platform !== 'Linux' || !['x86_64', 'aarch64'].includes(arch))
      throw new Error('此部署入口支持 Linux x64 / ARM64');
    const location = await this.jobs.exec(
      session,
      `set -eu
anchor="$HOME/.local/share/cagent/cshell"
if test -x "$anchor/current/cagent"; then target=$(readlink -f "$anchor"); else target=${directory ? quote(directory.replace(/\/+$/, '')) : '"$anchor"'}; fi
parent="$target"
while test ! -e "$parent"; do parent=$(dirname "$parent"); done
test -d "$parent" && test -w "$parent" || { echo '安装目录不可写' >&2; exit 1; }
printf '%s\\n' "$target"
df -hP "$parent" | tail -n 1`,
    );
    const [installDirectory, ...disk] = location.trim().split(/\r?\n/);
    const plan: LinuxWorkspacePlan = {
      id: randomUUID(),
      installed: state === 'installed',
      platform,
      arch,
      user,
      installDirectory,
      diskInfo: disk.join('\n'),
      steps:
        state === 'installed'
          ? ['连接已安装的 cagent，保留设备身份和浏览器资料']
          : [
              `安装目录：${installDirectory}（程序、私有运行时、构建缓存和新建数据）`,
              `当前系统 Node：${node}，npm：${npm}；保留不变`,
              `下载并核验私有 Node.js ${linuxNodeRuntime.version}，仅存入 cagent 用户目录`,
              '复用已检测到的编译工具；不安装系统软件，不修改软件源、全局 PATH 或 Shell 配置',
              '从固定版本 node-pty 1.1.0 构建原生终端组件',
              '核对上传程序 SHA256，启动仅回环监听的本机控制服务；不开放防火墙',
            ],
    };
    if (state !== 'installed' && missing.length)
      throw new Error(
        '缺少安装所需工具：' +
          missing.map((v) => v.replace('missing:', '')).join('、') +
          '。安装器不会修改系统，请准备依赖后重试。',
      );
    if (this.plans.size >= 50) this.plans.clear();
    this.plans.set(plan.id, { session, expires: Date.now() + 900000, plan });
    return plan;
  }
  async install(session: string, id: string) {
    const record = this.plans.get(id);
    if (!record || record.session !== session || record.expires < Date.now())
      throw new Error('安装计划已失效，请重新检查');
    this.ssh.get(session);
    this.plans.delete(id);
    if (record.plan.installed)
      return this.jobs.start(
        session,
        '启动 cagent',
        `${linuxWorkspaceLauncher} status >/dev/null 2>&1 || (nohup ${linuxWorkspaceLauncher} run </dev/null >"$HOME/.local/share/cagent/cshell/runtime.log" 2>&1 &)`,
      );
    const bytes = await readFile(this.payload),
      hash = createHash('sha256').update(bytes).digest('hex'),
      temporary = '/tmp/cshell-cagent-' + randomUUID() + '.cjs';
    const sftp = await this.ssh.sftp(session);
    await new Promise<void>((resolve, reject) => {
      const out = sftp.createWriteStream(temporary, { flags: 'wx', mode: 0o600 });
      out.on('error', reject);
      out.on('close', resolve);
      out.end(bytes);
    });
    return this.jobs.start(
      session,
      '安装 cagent',
      linuxWorkspaceInstallScript(
        record.plan.arch as 'x86_64' | 'aarch64',
        hash,
        temporary,
        record.plan.installDirectory,
      ),
    );
  }
  async call(session: string, raw: AgentCall, signal?: AbortSignal) {
    const call = agentCallSchema.parse(raw);
    if (!linuxWorkspaceMethods.has(call.method)) throw new Error('此操作未在 SSH 工作区开放');
    return (await this.bridge(session)).request(call, signal);
  }
  job(session: string, id: string, cancel = false) {
    this.ssh.get(session);
    const job = this.jobs.list(session).find((j) => j.id === id);
    if (!job) throw new Error('任务不属于当前连接');
    if (cancel) this.jobs.cancel(id);
    return this.jobs.list(session).find((j) => j.id === id)!;
  }
}
