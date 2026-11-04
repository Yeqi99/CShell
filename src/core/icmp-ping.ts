import { execFile } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import type { PingResult } from '../shared/icmp-ping';
export type { PingResult } from '../shared/icmp-ping';
export function parsePingOutput(text: string): { elapsedMs: number; lessThan: boolean } | null {
  const match = /(?:time|时间|時間)\s*([=<])\s*(\d+(?:[.,]\d+)?)\s*(?:ms|毫秒)/i.exec(text);
  return match ? { elapsedMs: Number(match[2].replace(',', '.')), lessThan: match[1] === '<' } : null;
}
export function pingResult(error: (Error & { code?: string | number }) | null, stdout: string, checkedAt: number): PingResult {
  const measured = parsePingOutput(stdout);
  return !error && measured ? { method: 'icmp', ...measured, status: 'reply', checkedAt }
    : { method: 'icmp', elapsedMs: null, status: error?.code === 'ENOENT' ? 'unsupported' : 'unreachable', checkedAt };
}
export type PingRoute = { interfaceAlias?: string; interfaceDescription?: string; sourceAddress?: string; nextHop?: string };
export function classifyPingRoute(address: string, route: PingRoute | null): 'direct' | 'proxy-path' | 'route-unknown' {
  if (address === '::1' || /^127\./.test(address)) return 'direct';
  const synthetic = (value = '') => /^198\.(18|19)\./.test(value);
  if (synthetic(address)) return 'proxy-path';
  if (!route?.interfaceAlias) return 'route-unknown';
  if (synthetic(route.sourceAddress) || synthetic(route.nextHop)
    || /(?:^|[\s_-])(?:meta|mihomo|clash|sing-box|wintun|wireguard|tun|tap)(?:$|[\s_-])/i.test(`${route.interfaceAlias} ${route.interfaceDescription || ''}`)) return 'proxy-path';
  return 'direct';
}
async function windowsPingRoute(address: string): Promise<PingRoute | null> {
  // Inspect only the route selected for this resolved IP; unrelated VPNs do not affect LAN probes.
  const script = `$ErrorActionPreference='Stop'; $r=@(Find-NetRoute -RemoteIPAddress '${address}'); $ip=$r|Where-Object {$_.IPAddress}|Select-Object -First 1; $rt=$r|Where-Object {$_.DestinationPrefix}|Select-Object -First 1; $a=Get-NetAdapter -IncludeHidden -InterfaceIndex $ip.InterfaceIndex -ErrorAction SilentlyContinue; @{interfaceAlias=$ip.InterfaceAlias;interfaceDescription=$a.InterfaceDescription;sourceAddress=$ip.IPAddress;nextHop=$rt.NextHop}|ConvertTo-Json -Compress`;
  return new Promise(resolve => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { timeout: 5000, maxBuffer: 16384, windowsHide: true }, (error, stdout) => {
      if (error) return resolve(null);
      try { resolve(JSON.parse(stdout)); } catch { resolve(null); }
    }));
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
  if (!isIP(address)) return pingResult(new Error('Invalid resolved address'), '', checkedAt);
  if (process.platform === 'win32') {
    const route = address === '::1' || /^127\./.test(address) ? null : await windowsPingRoute(address);
    const status = classifyPingRoute(address, route);
    if (status !== 'direct') return { method: 'icmp', status, elapsedMs: null, checkedAt, targetAddress: address, routeInterface: route?.interfaceAlias };
  }
  return new Promise(resolve => {
    // Resolve first: only an IP literal reaches the process arguments, never shell text.
    const args = process.platform === 'win32' ? ['-n', '1', '-w', '2000', address]
      : process.platform === 'darwin' ? ['-n', '-c', '1', '-W', '2000', address] : ['-n', '-c', '1', '-W', '2', address];
    execFile(process.platform === 'win32' ? 'ping.exe' : 'ping', args,
      { timeout: 3500, maxBuffer: 16384, windowsHide: true, encoding: 'buffer', env: { ...process.env, LC_ALL: 'C' } },
      (error, stdout) => {
        let text = stdout.toString('utf8');
        if (process.platform === 'win32' && !parsePingOutput(text)) text = new TextDecoder('gb18030').decode(stdout);
        resolve({ ...pingResult(error, text, checkedAt), targetAddress: address });
      });
  });
}
