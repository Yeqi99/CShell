import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, chmod, readFile, writeFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import type { SecretCodec } from '../core/store';

const exec = promisify(execFile);
export function agentDirectory() {
  return (
    process.env.CSHELL_AGENT_DATA ||
    (process.platform === 'win32'
      ? join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'CShell Agent')
      : join(process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'cshell-agent'))
  );
}
let sid: string | undefined;
export async function protectPath(path: string, directory = false) {
  if (process.platform !== 'win32') {
    await chmod(path, directory ? 0o700 : 0o600);
    return;
  }
  if (!sid) {
    const { stdout } = await exec('whoami.exe', ['/user', '/fo', 'csv', '/nh'], {
      windowsHide: true,
    });
    sid = stdout.match(/S-1-\d+(?:-\d+)+/)?.[0];
    if (!sid) throw new Error('无法核实本机用户身份');
  }
  const script = `$ErrorActionPreference='Stop';$p=[Console]::In.ReadToEnd();$sid=[Security.Principal.SecurityIdentifier]::new('${sid}');$acl=[Security.AccessControl.${directory ? 'DirectorySecurity' : 'FileSecurity'}]::new();$acl.SetOwner($sid);$acl.SetAccessRuleProtection($true,$false);$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,[Security.AccessControl.FileSystemRights]::FullControl,${directory ? "[Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'" : '[Security.AccessControl.InheritanceFlags]::None'},[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow));Set-Acl -LiteralPath $p -AclObject $acl`;
  await new Promise<void>((resolve, reject) => {
    const child = execFile(
      join(
        process.env.SystemRoot || 'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      ),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
      {
        windowsHide: true,
        timeout: 15000,
        env: {
          ...process.env,
          PSModulePath: join(
            process.env.SystemRoot || 'C:\\Windows',
            'System32',
            'WindowsPowerShell',
            'v1.0',
            'Modules',
          ),
        },
      },
      (error) => (error ? reject(new Error('无法限制 Agent 私有文件权限')) : resolve()),
    );
    child.stdin!.on('error', () => {});
    child.stdin!.end(path);
  });
}
export async function privateDirectory(directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error('Agent 数据目录必须为真实私有目录');
  if (process.platform !== 'win32' && info.uid !== process.getuid?.())
    throw new Error('Agent 数据目录属于其他用户');
  await protectPath(directory, true);
}
async function dpapi(input: Buffer, decrypt: boolean): Promise<Buffer> {
  const script = `Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $r=[Security.Cryptography.ProtectedData]::${decrypt ? 'Unprotect' : 'Protect'}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Write([Convert]::ToBase64String($r))`;
  return new Promise((resolve, reject) => {
    const child = spawn(
      join(
        process.env.SystemRoot || 'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      ),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let output = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('密钥保护超时'));
    }, 15000);
    child.stdout.on('data', (data) => {
      output += data;
      if (output.length > 65536) child.kill();
    });
    child.stderr.resume();
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.from(output.trim(), 'base64'));
      else reject(new Error('Windows 用户密钥保护失败'));
    });
    child.stdin.end(input.toString('base64'));
  });
}
export async function agentCodec(directory: string): Promise<SecretCodec> {
  await privateDirectory(directory);
  const path = join(directory, 'vault-key');
  let encoded: Buffer;
  try {
    encoded = await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const key = randomBytes(32);
    encoded = process.platform === 'win32' ? await dpapi(key, false) : key;
    try {
      await writeFile(path, encoded, { flag: 'wx', mode: 0o600 });
      await protectPath(path);
    } catch (writeError) {
      if ((writeError as NodeJS.ErrnoException).code !== 'EEXIST') throw writeError;
      encoded = await readFile(path);
    }
  }
  if ((await lstat(path)).isSymbolicLink()) throw new Error('非法密钥文件');
  const key = process.platform === 'win32' ? await dpapi(encoded, true) : encoded;
  if (key.length !== 32) throw new Error('Agent 密钥损坏；请恢复原始密钥备份');
  return {
    async encrypt(value) {
      const nonce = randomBytes(12),
        cipher = createCipheriv('aes-256-gcm', key, nonce);
      return Buffer.concat([
        nonce,
        cipher.update(value, 'utf8'),
        cipher.final(),
        cipher.getAuthTag(),
      ]).toString('base64');
    },
    async decrypt(value) {
      const buffer = Buffer.from(value, 'base64');
      if (buffer.length < 28) throw new Error('Agent 加密数据损坏');
      const decipher = createDecipheriv('aes-256-gcm', key, buffer.subarray(0, 12));
      decipher.setAuthTag(buffer.subarray(-16));
      return Buffer.concat([decipher.update(buffer.subarray(12, -16)), decipher.final()]).toString(
        'utf8',
      );
    },
  };
}
