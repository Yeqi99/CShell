import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';
import { z } from 'zod';

const statusSchema = z.object({
  installed: z.boolean(), running: z.boolean(), elevated: z.boolean(),
  runtimeImagePath: z.string(), proxyPath: z.string(), proxyPresent: z.boolean(),
});
export async function systemDesktopStatus(directory: string) {
  if (process.platform !== 'win32') return { supported: false, ready: false };
  try {
    const { stdout } = await promisify(execFile)(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(directory, 'system-desktop-status.ps1')],
      { windowsHide: true, timeout: 10_000, maxBuffer: 16_384 });
    const state = statusSchema.parse(JSON.parse(stdout.replace(/^\uFEFF/, '')));
    const runtimeMatches = !!state.runtimeImagePath && resolve(state.runtimeImagePath).toLowerCase() === resolve(process.execPath).toLowerCase();
    return { supported: true, ...state, runtimeMatches,
      ready: state.running && state.elevated && state.proxyPresent && runtimeMatches };
  } catch {
    return { supported: true, ready: false, error: '无法核对系统桌面服务状态' };
  }
}
