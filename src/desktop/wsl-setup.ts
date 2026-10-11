import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import type { WslSetupState } from '../shared/local-terminal';
const exec = promisify(execFile);
// Only fixed host-owned commands may cross the elevation boundary.
export function wslSetupScript(ubuntu: boolean) {
  const args = ubuntu
    ? "'--install','--distribution','Ubuntu','--no-launch'"
    : "'--install','--no-distribution'";
  return `$ErrorActionPreference='Stop'; try { $p=Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\\wsl.exe') -ArgumentList ${args} -Verb RunAs -WindowStyle Hidden -Wait -PassThru; Write-Output $p.ExitCode } catch { exit 1 }`;
}
export class WslSetup {
  private state: WslSetupState = { phase: 'idle' };
  constructor(
    private run: (ubuntu: boolean) => Promise<number> = async (ubuntu) => {
      const { stdout } = await exec(
        join(
          process.env.SystemRoot || 'C:/Windows',
          'System32',
          'WindowsPowerShell',
          'v1.0',
          'powershell.exe',
        ),
        [
          '-NoProfile',
          '-NonInteractive',
          '-EncodedCommand',
          Buffer.from(wslSetupScript(ubuntu), 'utf16le').toString('base64'),
        ],
        { windowsHide: true, maxBuffer: 65536 },
      );
      return Number(stdout.trim());
    },
  ) {}
  snapshot(): WslSetupState {
    return { ...this.state };
  }
  start(ubuntu: boolean) {
    if (this.state.phase === 'running') return this.snapshot();
    this.state = { phase: 'running', message: '请完成 Windows 管理员授权，正在安装 WSL…' };
    void this.run(ubuntu)
      .then((code) => {
        this.state =
          code === 0 || code === 3010
            ? {
                phase: 'complete',
                message:
                  code === 3010
                    ? '需要重启 Windows。保存工作并手动重启后，返回此处刷新。'
                    : '安装流程已完成。若未出现发行版，请按系统要求重启后刷新；仅启用 WSL 时还需安装发行版。',
              }
            : {
                phase: 'error',
                message: `WSL 安装未完成（退出码 ${code}）。可重试或使用安装命令查看系统详情。`,
              };
      })
      .catch(() => {
        this.state = { phase: 'error', message: '未完成管理员授权或安装程序启动失败。可以重试。' };
      });
    return this.snapshot();
  }
}
