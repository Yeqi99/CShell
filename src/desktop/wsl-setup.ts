import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import type { WslSetupState } from '../shared/local-terminal';
import { downloadUbuntu } from './wsl-download';
const exec = promisify(execFile);
export function decodeWslOutput(buffer: Buffer) {
  return (buffer.includes(0) ? buffer.toString('utf16le') : buffer.toString('utf8'))
    .replace(/^\uFEFF/, '')
    .replace(/\r\r/g, '\r')
    .trim();
}
export function wslInstallArguments(help: string, ubuntu: boolean) {
  if (!help.includes('--no-launch')) {
    if (!ubuntu)
      throw new Error(
        '当前为 Windows WSL 引导程序，仅支持安装默认发行版。请勾选“同时安装 Ubuntu”，或先通过 Windows 安装新版 WSL。',
      );
    return ['--install'];
  }
  return ubuntu
    ? ['--install', '--distribution', 'Ubuntu', '--no-launch']
    : ['--install', '--no-distribution'];
}
const quote = (value: string) => "'" + value.replace(/'/g, "''") + "'";
export function wslFailureMessage(code: number, details: string) {
  if (/WININET_E_CANNOT_CONNECT|WININET_E_TIMEOUT|WININET_E_NAME_NOT_RESOLVED/i.test(details))
    return '无法连接 WSL 发行版下载服务。请检查 Windows 系统代理与网络，恢复后重试安装。';
  return `WSL 安装未完成（退出码 ${code}）。请查看下方系统输出。`;
}
export function wslSetupScript(ubuntu: boolean) {
  return `$p=Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\\wsl.exe') -ArgumentList ${wslInstallArguments('--no-launch', ubuntu).map(quote).join(',')} -Verb RunAs -WindowStyle Hidden -Wait -PassThru; Write-Output $p.ExitCode`;
}
async function install(ubuntu: boolean): Promise<{ code: number; details: string }> {
  const system = join(process.env.SystemRoot || 'C:/Windows', 'System32');
  const executable = join(system, 'wsl.exe');
  let help: Buffer;
  try {
    help = (
      await exec(executable, ['--help'], { encoding: 'buffer', windowsHide: true, timeout: 15000 })
    ).stdout;
  } catch (e) {
    help = (e as { stdout?: Buffer }).stdout ?? Buffer.alloc(0);
  }
  if (!help.length) throw new Error('无法读取 Windows WSL 安装程序。');
  const args = wslInstallArguments(decodeWslOutput(help), ubuntu);
  // Distribution registration belongs to the current user. Only bootstrap/component
  // installation needs our elevated helper; do not change users/network context for a distro.
  const installed = await exec(executable, ['--version'], {
    encoding: 'buffer',
    windowsHide: true,
    timeout: 15000,
  }).then(
    () => true,
    () => false,
  );
  if (ubuntu && installed) {
    try {
      const result = await exec(executable, args, {
        encoding: 'buffer',
        windowsHide: true,
        maxBuffer: 4_000_000,
      });
      return {
        code: 0,
        details: [result.stdout, result.stderr]
          .map(decodeWslOutput)
          .filter(Boolean)
          .join('\n')
          .slice(-12000),
      };
    } catch (e) {
      const result = e as { code?: number | string; stdout?: Buffer; stderr?: Buffer };
      const details = [result.stdout, result.stderr]
        .filter((b): b is Buffer => Buffer.isBuffer(b))
        .map(decodeWslOutput)
        .join('\n');
      if (
        /WININET_E_CANNOT_CONNECT|WININET_E_TIMEOUT|WININET_E_NAME_NOT_RESOLVED/i.test(details) &&
        decodeWslOutput(help).includes('--from-file')
      ) {
        const directory = await mkdtemp(join(tmpdir(), 'cshell-ubuntu-')),
          image = join(directory, 'Ubuntu.wsl');
        try {
          const { net } = await import('electron');
          await downloadUbuntu(image, net.fetch.bind(net) as typeof fetch);
          const installed = await exec(
            executable,
            ['--install', '--from-file', image, '--no-launch'],
            { encoding: 'buffer', windowsHide: true, maxBuffer: 4000000 },
          );
          return {
            code: 0,
            details:
              '已通过系统代理下载官方 Ubuntu 镜像，SHA-256 校验通过。\n' +
              decodeWslOutput(installed.stdout),
          };
        } catch (fallback) {
          return { code: -1, details: details + '\n官方镜像安装：' + (fallback as Error).message };
        } finally {
          await rm(image, { force: true }).catch(() => {});
        }
      }
      return {
        code: typeof result.code === 'number' ? result.code : -1,
        details:
          [result.stdout, result.stderr]
            .filter((b): b is Buffer => Buffer.isBuffer(b))
            .map(decodeWslOutput)
            .join('\n')
            .slice(-12000) || (e as Error).message,
      };
    }
  }
  const directory = await mkdtemp(join(tmpdir(), 'cshell-wsl-'));
  const output = join(directory, 'output.log'),
    error = join(directory, 'error.log');
  const ps = join(system, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const inner = `$ErrorActionPreference='Stop'; try { $p=Start-Process -FilePath ${quote(executable)} -ArgumentList ${args.map(quote).join(',')} -RedirectStandardOutput ${quote(output)} -RedirectStandardError ${quote(error)} -WindowStyle Hidden -Wait -PassThru; exit $p.ExitCode } catch { $_.Exception.Message | Out-File -LiteralPath ${quote(error)} -Encoding utf8; exit 1 }`;
  const encoded = Buffer.from(inner, 'utf16le').toString('base64');
  const outer = `$ErrorActionPreference='Stop'; try { $p=Start-Process -FilePath ${quote(ps)} -ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand','${encoded}' -Verb RunAs -WindowStyle Hidden -Wait -PassThru; Write-Output $p.ExitCode } catch { exit 1 }`;
  try {
    let stdout: string;
    try {
      stdout = (
        await exec(
          ps,
          [
            '-NoProfile',
            '-NonInteractive',
            '-EncodedCommand',
            Buffer.from(outer, 'utf16le').toString('base64'),
          ],
          {
            windowsHide: true,
            maxBuffer: 65536,
            env: {
              ...process.env,
              PSModulePath: join(system, 'WindowsPowerShell', 'v1.0', 'Modules'),
            },
          },
        )
      ).stdout;
    } catch {
      throw new Error('管理员授权未完成，或 Windows 安装进程无法启动。');
    }
    const details = (
      await Promise.all(
        [output, error].map(async (p) =>
          decodeWslOutput(await readFile(p).catch(() => Buffer.alloc(0))),
        ),
      )
    )
      .filter(Boolean)
      .join('\n')
      .slice(-12000);
    const code = /^-?\d+$/.test(stdout.trim()) ? Number(stdout.trim()) : -1;
    return { code, details };
  } finally {
    // Exact files in a directory created by this operation; never remove an arbitrary tree.
    await Promise.all([output, error].map((p) => rm(p, { force: true }).catch(() => {})));
  }
}
export class WslSetup {
  private state: WslSetupState = { phase: 'idle' };
  constructor(
    private run: (ubuntu: boolean) => Promise<number | { code: number; details: string }> = install,
  ) {}
  snapshot(): WslSetupState {
    return { ...this.state };
  }
  start(ubuntu: boolean) {
    if (this.state.phase === 'running') return this.snapshot();
    this.state = {
      phase: 'running',
      message: '正在安装，请稍候；如 Windows 请求管理员授权，请完成授权。',
    };
    void this.run(ubuntu)
      .then((result) => {
        const { code, details } =
          typeof result === 'number' ? { code: result, details: '' } : result;
        this.state = {
          phase: code === 0 || code === 3010 ? 'complete' : 'error',
          details,
          message:
            code === 3010
              ? '需要重启 Windows。保存工作并手动重启后返回刷新。'
              : code === 0
                ? '安装程序已完成。请刷新检测；如系统要求重启，请保存工作后手动重启。'
                : wslFailureMessage(code, details),
        };
      })
      .catch((e) => {
        this.state = { phase: 'error', message: (e as Error).message };
      });
    return this.snapshot();
  }
}
