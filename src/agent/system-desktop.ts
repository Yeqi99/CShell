import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';
import { z } from 'zod';

const statusSchema = z.object({
  packageMatches: z.boolean().default(false), updateRequired: z.boolean().default(true),
  installed: z.boolean(), running: z.boolean(), elevated: z.boolean(),
  runtimeImagePath: z.string(), proxyPath: z.string(), proxyPresent: z.boolean(),
});
export function systemDesktopReady(value: unknown, runtimeImage: string) {
  const state=statusSchema.parse(value);
  const runtimeMatches=!!state.runtimeImagePath && resolve(state.runtimeImagePath).toLowerCase()===resolve(runtimeImage).toLowerCase();
  return {...state,runtimeMatches,ready:state.packageMatches&&state.running&&state.elevated&&state.proxyPresent&&runtimeMatches};
}
export function needsSystemDesktopRefresh(state: {ready?:boolean;installed?:boolean;elevated?:boolean;packageMatches?:boolean;runtimeMatches?:boolean}) {
  return state.installed===true && state.elevated===true && (state.packageMatches===false || state.runtimeMatches===false);
}
/** Maintain only an existing service owned by the same Windows user. No UAC,
 * new service enrollment, network listener or permission changes are made. */
export async function refreshExistingSystemDesktop(directory:string) {
  if(process.platform!=='win32')return;
  await promisify(execFile)(join(process.env.SystemRoot || 'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),
    ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',join(directory,'install-system-service.ps1'),'-RefreshExisting','-RuntimeImagePath',process.execPath],
    {windowsHide:true,timeout:60_000,maxBuffer:16_384});
}
export async function systemDesktopStatus(directory: string) {
  if (process.platform !== 'win32') return { supported: false, ready: false };
  try {
    const { stdout } = await promisify(execFile)(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(directory, 'system-desktop-status.ps1')],
      { windowsHide: true, timeout: 10_000, maxBuffer: 16_384 });
    return {supported:true,...systemDesktopReady(JSON.parse(stdout.replace(/^\uFEFF/, '')),process.execPath)};
  } catch {
    return { supported: true, ready: false, error: '无法核对系统桌面服务状态' };
  }
}
