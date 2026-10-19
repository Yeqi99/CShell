import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export const virtualDisplayRelease = Object.freeze({
  version: '25.7.23',
  url: 'https://github.com/VirtualDrivers/Virtual-Display-Driver/releases/download/25.7.23/VirtualDisplayDriver-x86.Driver.Only.zip',
  sha256: 'e24210692b442b39af763536330ce78b423f19342b7a7792c26de3944e418b3a',
  signer: 'CN=SignPath Foundation, O=SignPath Foundation, L=Lewes, S=Delaware, C=US',
  signerThumbprint: '3CF8CF26D8BA266C3A483AB7D26D4A818E317D76',
  license: 'MIT',
});

export const virtualDisplayInstallInput = z.object({
  confirm: z.literal(true), width: z.number().int().positive().max(2147483647),
  height: z.number().int().positive().max(2147483647),
  experimentalServer: z.boolean().default(false),
}).strict();
const taskId = z.string().regex(/^[a-f0-9]{32}$/);
type Invoke = (args: string[], timeout: number) => Promise<unknown>;
type Host = { platform: string; arch: string; build: number; server: boolean };

export async function virtualDisplayHost(): Promise<Host> {
  if (process.platform !== 'win32') return { platform: process.platform, arch: process.arch, build: 0, server: false };
  const execute = promisify(execFile);
  const { stdout } = await execute(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_OperatingSystem | Select-Object BuildNumber,ProductType | ConvertTo-Json -Compress'], { windowsHide: true, timeout: 15_000, maxBuffer: 8192 });
  const os = z.object({ BuildNumber: z.string().regex(/^\d+$/), ProductType: z.number().int().min(1).max(3) }).parse(JSON.parse(stdout));
  return { platform: process.platform, arch: process.arch, build: Number(os.BuildNumber), server: os.ProductType !== 1 };
}

/** Fixed upstream archive, bounded download, digest before extraction; no upstream scripts run. */
export async function prepareVirtualDisplayPackage() {
  const root = await mkdtemp(join(tmpdir(), 'cagent-vdd-package-'));
  const cleanup = () => rm(root, { recursive: true, force: true });
  try {
    const response = await fetch(virtualDisplayRelease.url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok || !response.body) throw new Error('虚拟显示驱动下载失败');
    let size = 0; const chunks: Uint8Array[] = [];
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      size += chunk.byteLength;
      if (size > 1024 * 1024) { await response.body.cancel().catch(() => {}); throw new Error('驱动附件超出预期大小'); }
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    if (createHash('sha256').update(bytes).digest('hex') !== virtualDisplayRelease.sha256) throw new Error('驱动附件摘要不匹配');
    const archive = join(root, 'driver.zip'), destination = join(root, 'extracted');
    await writeFile(archive, bytes, { flag: 'wx' });
    const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
    const script = `$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath ${quote(archive)} -DestinationPath ${quote(destination)}`;
    await promisify(execFile)(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 30_000, maxBuffer: 8192 });
    return { directory: join(destination, 'VirtualDisplayDriver'), cleanup };
  } catch (error) { await cleanup(); throw error; }
}

/** Adapter for existing applications plan/install/status flows. The caller retains machine/owner authorization.
 * packageDirectory must be a fixed backend-owned extracted release, never a remote caller-supplied path.
 * Native commands do not auto-elevate. Cancellation/timeout is an unknown outcome: query/recover its journal.
 */
export class VirtualDisplayBackend {
  private busy = false;
  constructor(private host: Host, private packageDirectory: string, private invoke: Invoke) {}
  static native(host: Host, packageDirectory: string, helper: string) {
    const execute = promisify(execFile);
    return new VirtualDisplayBackend(host, packageDirectory, async (args, timeout) => {
      try {
        const result = await execute(helper, args, { windowsHide: true, timeout, maxBuffer: 1024 * 1024 });
        return JSON.parse(result.stdout);
      } catch (error) {
        const stdout = (error as { stdout?: string }).stdout;
        if (stdout) {
          try { const value = JSON.parse(stdout); if (typeof value.error === 'string') throw new Error(value.error); }
          catch (parsed) { if (!(parsed instanceof SyntaxError)) throw parsed; }
        }
        throw new Error('虚拟显示操作未确认完成；不要重复安装，先查询任务日志并恢复', { cause: error });
      }
    });
  }
  plan() {
    const compatible = this.host.platform === 'win32' && this.host.arch === 'x64' && this.host.build >= 19041;
    return { release: virtualDisplayRelease, compatible, experimental: this.host.server,
      requiresAdministrator: true, hardwareVerified: false,
      warning: '仅新增独立虚拟显示设备，保留原主屏；失败尝试回滚。真实安装与无头/重启验收尚未完成。Server 仅实验支持。' };
  }
  probe() { return this.invoke(['probe'], 15_000); }
  status(id: string) { return this.invoke(['status', taskId.parse(id)], 15_000); }
  list() { return this.invoke(['list'], 15_000); }
  private async mutate(args: string[]) {
    if (this.busy) throw new Error('虚拟显示操作正在执行');
    this.busy = true;
    try { return await this.invoke(args, 120_000); } finally { this.busy = false; }
  }
  install(input: unknown) {
    const value = virtualDisplayInstallInput.parse(input);
    if (!this.plan().compatible) throw new Error('仅支持 Windows 10/11 x64 候选平台');
    if (this.host.server && !value.experimentalServer) throw new Error('Windows Server 尚未经实机验证，需明确选择实验支持');
    return this.mutate(['install', this.packageDirectory, String(value.width), String(value.height)]);
  }
  remove(id: string, confirm: true) {
    if (confirm !== true) throw new Error('需要确认移除');
    return this.mutate(['remove', taskId.parse(id)]);
  }
  recover(id: string, confirm: true) {
    if (confirm !== true) throw new Error('需要确认恢复安装前显示布局');
    return this.mutate(['recover', taskId.parse(id)]);
  }
}
