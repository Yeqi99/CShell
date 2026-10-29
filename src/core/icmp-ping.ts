import { execFile } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export type PingResult = { method: 'icmp'; elapsedMs: number | null; lessThan?: boolean; status: 'reply' | 'unreachable' | 'unsupported'; checkedAt: number };
export function parsePingOutput(text: string): { elapsedMs: number; lessThan: boolean } | null {
  const match = /(?:time|时间|時間)\s*([=<])\s*(\d+(?:[.,]\d+)?)\s*(?:ms|毫秒)/i.exec(text);
  return match ? { elapsedMs: Number(match[2].replace(',', '.')), lessThan: match[1] === '<' } : null;
}
export function pingResult(error: (Error & { code?: string | number }) | null, stdout: string, checkedAt: number): PingResult {
  const measured = parsePingOutput(stdout);
  return !error && measured ? { method: 'icmp', ...measured, status: 'reply', checkedAt }
    : { method: 'icmp', elapsedMs: null, status: error?.code === 'ENOENT' ? 'unsupported' : 'unreachable', checkedAt };
}
export async function pingHost(host: string): Promise<PingResult> {
  const checkedAt = Date.now();
  let address: string;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    address = isIP(host) ? host : await Promise.race([
      lookup(host).then(result => result.address),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('DNS timeout')), 2500); }),
    ]);
  } catch { return pingResult(new Error('Address unavailable'), '', checkedAt); }
  finally { clearTimeout(timer); }
  return new Promise(resolve => {
    // Resolve first: only an IP literal reaches the process arguments, never shell text.
    const args = process.platform === 'win32' ? ['-n', '1', '-w', '2000', address]
      : process.platform === 'darwin' ? ['-n', '-c', '1', '-W', '2000', address] : ['-n', '-c', '1', '-W', '2', address];
    execFile(process.platform === 'win32' ? 'ping.exe' : 'ping', args,
      { timeout: 3500, maxBuffer: 16384, windowsHide: true, encoding: 'buffer', env: { ...process.env, LC_ALL: 'C' } },
      (error, stdout) => {
        let text = stdout.toString('utf8');
        if (process.platform === 'win32' && !parsePingOutput(text)) text = new TextDecoder('gb18030').decode(stdout);
        resolve(pingResult(error, text, checkedAt));
      });
  });
}
