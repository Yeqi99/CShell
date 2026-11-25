import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

export const trialEndpoint = 'https://shell.canp.ai/api/v1/cagent/trial/chat/completions';
export async function trialDeviceId(fallback: string) {
  let value = '';
  try {
    if (process.platform === 'win32') {
      const {stdout} = await promisify(execFile)('reg.exe', ['query','HKLM\\SOFTWARE\\Microsoft\\Cryptography','/v','MachineGuid','/reg:64'], {timeout:3000,windowsHide:true});
      value = /MachineGuid\s+REG_SZ\s+([\da-f-]+)/i.exec(stdout)?.[1] ?? '';
    } else if (process.platform === 'darwin') {
      const {stdout} = await promisify(execFile)('/usr/sbin/ioreg',['-rd1','-c','IOPlatformExpertDevice'],{timeout:3000});
      value = /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(stdout)?.[1] ?? '';
    } else {
      value = (await readFile('/etc/machine-id','utf8')).trim();
    }
  } catch { /* The existing CAgent identity is stable when OS metadata is unavailable. */ }
  return createHash('sha256').update('cshell/cagent/trial/v1/'+(value||fallback).toLowerCase()).digest('hex');
}
