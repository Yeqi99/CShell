import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ClientVault } from '../core/client/identity';
import { detectAgentShells } from '../core/agent-terminal';
import {wslGuidance,wslInstallArgs} from './wsl-diagnostics';

const exec = promisify(execFile);
const distributionSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const stateSchema = z.object({
  id: z.string().uuid(),
  distribution: distributionSchema,
  args: z.array(z.string()),
  state: z.enum([
    'planned',
    'running',
    'completed',
    'failed',
    'cancelled',
    'interrupted',
    'restart-required',
  ]),
  logs: z.string(),
  code: z.number().optional(),
  operation:z.enum(['install','update']).default('install'),
  elevated:z.boolean().default(false),
});
type Installation = z.infer<typeof stateSchema>;
const decode = (buffer: Buffer) =>
  (buffer.includes(0) ? buffer.toString('utf16le') : buffer.toString('utf8'))
    .replace(/^\uFEFF/, '')
    .replace(/\r\r/g, '\r');
const executable = () => join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wsl.exe');
function requireWindows() {
  if (process.platform !== 'win32') throw new Error('WSL 仅适用于 Windows Agent');
}

export class AgentWslService {
  private installation?: Installation;
  private process?: ChildProcess;
  private accountBusy = false;
  get activity(){return (this.process?1:0)+(this.accountBusy?1:0)+(this.installation?.state==='running'?1:0);}
  constructor(private vault: ClientVault) {}
  async load() {
    this.installation = await this.vault.read('wsl-installation', stateSchema);
    if (this.installation?.state === 'running') {
      this.installation.state = 'interrupted';
      this.installation.logs += '\nAgent 已重启；请重新检查发行版后继续。';
      await this.persist();
    }
  }
  private persist() {
    return this.vault.write('wsl-installation', this.installation);
  }
  async check() {
    if (process.platform !== 'win32')
      return { supported: false, distributions: [], online: [], installation: this.installation };
    const ps = join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
    const script = `$p=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent());$v=Get-CimInstance Win32_Processor | Select-Object -First 1; @{ administrator=$p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator);virtualization=([bool]$v.VirtualizationFirmwareEnabled -or [bool](Get-CimInstance Win32_ComputerSystem).HypervisorPresent);rebootPending=((Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Component Based Servicing\\RebootPending') -or (Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate\\Auto Update\\RebootRequired')) } | ConvertTo-Json -Compress`;
    const details = JSON.parse(
      (
        await exec(ps, ['-NoProfile', '-NonInteractive', '-Command', script], {
          windowsHide: true,
          timeout: 15000,
        })
      ).stdout,
    );
    let help='';try{help=decode((await exec(executable(),['--help'],{encoding:'buffer',windowsHide:true,timeout:10000,maxBuffer:262144})).stdout);}catch{}
    let online: string[] = [],
      onlineError: string | undefined;
    try {
      const { stdout } = await exec(executable(), ['--list', '--online'], {
        windowsHide: true,
        timeout: 20000,
        encoding: 'buffer',
        maxBuffer: 262144,
      });
      const lines = decode(stdout).split(/\r?\n/);
      const header = lines.findIndex((line) => /^\s*NAME\s+FRIENDLY NAME\s*$/i.test(line));
      online = lines
        .slice(header >= 0 ? header + 1 : lines.length)
        .map((line) => line.trim().split(/\s+/)[0])
        .filter((v) => distributionSchema.safeParse(v).success);
      if (!online.length) onlineError = '无法解析系统提供的可安装发行版列表';
    } catch (error) {
      onlineError = error instanceof Error ? error.message.slice(0, 500) : '无法获取发行版列表';
    }
    return {
      supported: true,
      ...details,
      distributions: (await detectAgentShells())
        .filter((s) => s.environment === 'wsl')
        .map((s) => s.distribution!),
      online,
      onlineError,
      webDownloadSupported:help.includes('--web-download'),
      updateSupported:help.includes('--update'),
      guidance:wslGuidance(this.installation?.logs??''),
      installation: this.installation,
    };
  }
  async plan(input: unknown) {
    requireWindows();
    if (this.process) throw new Error('WSL 安装正在运行');
    const { distribution,webDownload,operation } = z.object({ distribution: distributionSchema,webDownload:z.boolean().default(false),operation:z.enum(['install','update']).default('install') }).strict().parse(input);
    const check = await this.check();
    if(operation==='install'){
      if (!check.online.includes(distribution)) throw new Error('请选择系统真实返回的可安装发行版；网络异常时先恢复下载连接');
      if (check.distributions.includes(distribution)) throw new Error('发行版已安装，无需覆盖');
      if (!check.virtualization) throw new Error('虚拟化未启用，请检查 BIOS/UEFI；云服务器需要开放嵌套虚拟化');
    }else if(!check.updateSupported)throw new Error('当前系统 WSL 不支持在线更新，请更新 Windows 或使用微软 WSL 安装程序');
    if(webDownload&&!check.webDownloadSupported)throw new Error('此 WSL 版本不支持直接下载，请使用默认下载方式');
    this.installation = {
      id: randomUUID(),
      distribution,
      args: wslInstallArgs(distribution,webDownload,operation==='update'),operation,elevated:false,
      state: 'planned',
      logs: '目标：当前 Windows Agent。可能需要管理员权限及重启；不会自动提权或重启。',
    };
    await this.persist();
    return {
      ...this.installation,
      administrator: check.administrator,
      mayRequireAdministrator: true,
      mayRequireRestart: true,
    };
  }
  async install(input: unknown) {
    requireWindows();
    const { planId,elevate } = z
      .object({ planId: z.string().uuid(), confirm: z.literal(true),elevate:z.boolean().default(false) })
      .strict()
      .parse(input);
    const state = this.installation;
    if (!state || state.id !== planId || this.process || state.state === 'completed')
      throw new Error('安装计划已失效或正在执行');
    state.state = 'running';
    state.elevated=elevate;
    state.logs += '\n开始执行系统 WSL 安装。';
    await this.persist();
    // The user explicitly chooses elevation. The fixed validated argument list
    // is encoded, never interpolated from free-form shell text. No reboot flag.
    const encodedArgs=Buffer.from(JSON.stringify(state.args)).toString('base64');
    const elevation=`$ErrorActionPreference='Stop';try{$a=ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedArgs}')));$p=Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\\wsl.exe') -ArgumentList $a -WindowStyle Hidden -Verb RunAs -Wait -PassThru;exit $p.ExitCode}catch{Write-Output $_.Exception.Message;exit 1}`;
    const child = spawn(elevate?'powershell.exe':executable(), elevate?['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(elevation,'utf16le').toString('base64')]:state.args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.process = child;
    const append = (data: Buffer) => {
      state.logs = (state.logs + decode(data)).slice(-65536);
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.once('error', (error) => {
      state.state = 'failed';
      state.logs = (state.logs + '\n' + error.message).slice(-65536);
      this.process = undefined;
      void this.persist();
    });
    child.once('close', async (code) => {
      if (state.state !== 'cancelled'){
        state.state = code === 3010 ? 'restart-required' : code === 0 ? 'completed' : 'failed';
        if(code===0&&state.operation==='install'){
          const present=await detectAgentShells().then(shells=>shells.some(s=>s.distribution===state.distribution)).catch(()=>false);
          if(!present){state.state='restart-required';state.logs+='\n尚未检测到可用发行版；系统组件可能等待重启。请按 Windows 提示重启后重新检查并继续安装。';}
        }
      }
      state.code = code ?? -1;
      if(this.process===child)this.process = undefined;
      void this.persist();
    });
    return this.status();
  }
  status() {
    return this.installation ? structuredClone(this.installation) : null;
  }
  async cancel() {
    if (this.process && this.installation) {
      if(this.installation.elevated)throw new Error('管理员安装由 Windows 执行，普通进程无法安全取消；请等待安装完成，不会自动重启');
      this.installation.state = 'cancelled';
      this.installation.logs += '\n用户取消；系统组件可能已部分安装，请重新检查。';
      this.process.kill();
      await this.persist();
    }
    return this.status();
  }
  async accountStatus(input: unknown) {
    requireWindows();
    const { distribution } = z.object({ distribution: distributionSchema }).strict().parse(input);
    if (!(await detectAgentShells()).some((s) => s.distribution === distribution))
      throw new Error('WSL 发行版不存在');
    const { stdout } = await exec(executable(), ['-d', distribution, '--exec', 'id', '-u'], {
      windowsHide: true,
      timeout: 30000,
    });
    return { distribution, ready: /^\d+$/.test(stdout.trim()) && Number(stdout.trim()) !== 0 };
  }
  async initializeAccount(input: unknown) {
    requireWindows();
    const { distribution, username, password } = z
      .object({
        distribution: distributionSchema,
        username: z.string().regex(/^[a-z_][a-z0-9_-]{0,30}$/),
        password: z
          .string()
          .min(1)
          .max(1024)
          .regex(/^[^\0\r\n]+$/),
        confirm: z.literal(true),
      })
      .strict()
      .parse(input);
    if (this.accountBusy) throw new Error('正在初始化 Linux 用户');
    this.accountBusy = true;
    try {
      if ((await this.accountStatus({ distribution })).ready)
        throw new Error('发行版已经配置默认用户');
      const help = decode(
        (
          await exec(executable(), ['--help'], {
            encoding: 'buffer',
            windowsHide: true,
            timeout: 15000,
          })
        ).stdout,
      );
      if (!help.includes('--set-default-user'))
        throw new Error('当前 WSL 不支持设置默认用户，请在目标 Windows 更新 WSL');
      const script = `set -eu\nu="$1"\nmarker="/var/lib/cshell/setup-$u"\nif id "$u" >/dev/null 2>&1; then test -f "$marker" || exit 1; else mkdir -p /var/lib/cshell; useradd -m -s /bin/sh "$u"; touch "$marker"; fi\nIFS= read -r password\nprintf '%s:%s\\n' "$u" "$password" | chpasswd\nunset password\n`;
      await new Promise<void>((resolve, reject) => {
        const child = execFile(
          executable(),
          ['-d', distribution, '-u', 'root', '--exec', 'sh', '-c', script, 'cshell', username],
          { windowsHide: true, timeout: 60000 },
          (error) =>
            error ? reject(new Error('Linux 用户初始化失败，未覆盖其他已有账户')) : resolve(),
        );
        child.stdin!.on('error', () => {});
        child.stdin!.end(password + '\n');
      });
      await exec(executable(), ['--manage', distribution, '--set-default-user', username], {
        windowsHide: true,
        timeout: 30000,
      });
      const status = await this.accountStatus({ distribution });
      if (!status.ready) throw new Error('默认 Linux 用户验证失败，请使用本机恢复入口检查');
      await exec(
        executable(),
        [
          '-d',
          distribution,
          '-u',
          'root',
          '--exec',
          'rm',
          '-f',
          `/var/lib/cshell/setup-${username}`,
        ],
        { windowsHide: true, timeout: 15000 },
      );
      return status;
    } finally {
      this.accountBusy = false;
    }
  }
  async dispose() {
    if(this.process&&this.installation?.elevated){this.installation.state='interrupted';this.installation.logs+='\nCAgent 已退出，管理员安装可能仍在运行；重新打开后先检查系统状态，不要重复安装。';await this.persist();this.process.kill();return;}
    await this.cancel();
  }
}
