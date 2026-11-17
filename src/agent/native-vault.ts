import { execFile } from 'node:child_process';
import { join } from 'node:path';

/** The packaged helper lives alongside the private CAgent Node runtime. */
export function nativeVaultKey(input: Buffer, decrypt: boolean): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = execFile(join(__dirname, 'cagent-vault.exe'), [decrypt ? 'open' : 'seal'], {
      encoding: 'buffer', windowsHide: true, timeout: 15000, maxBuffer: 4096,
    }, (error, result) => {
      if (error || !result.length || (decrypt && result.length !== 32)) {
        reject(new Error('Windows 当前用户无法访问 CAgent 设备密钥'));
      } else {
        resolve(result);
      }
    });
    child.stdin!.on('error', () => {});
    child.stdin!.end(input);
  });
}
