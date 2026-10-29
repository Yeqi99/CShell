import type { ProcessNetworkSnapshot } from '../shared/network-metrics';
// A bounded capture, only after a user asks; no elevation or dependency installation.
export const processNetworkCommand = `LC_ALL=C; export LC_ALL
if ! command -v nethogs >/dev/null 2>&1; then printf '__MISSING_NETHOGS__\\n'; exit 0; fi
if ! command -v timeout >/dev/null 2>&1; then printf '__UNAVAILABLE__\\n'; exit 0; fi
timeout -k 1 5 nethogs -t -v 0 -c 3 -d 1 2>/dev/null || printf '__UNAVAILABLE__\\n'`;
export function parseProcessNetwork(output: string): ProcessNetworkSnapshot {
  const base = { sampledAt: Date.now(), entries: [] };
  if (output.includes('__MISSING_NETHOGS__')) return { ...base, status: 'missing-tool' };
  if (output.includes('__UNAVAILABLE__') || !output.includes('Refreshing:'))
    return { ...base, status: 'unavailable' };
  const last = output.split('Refreshing:').at(-1)!;
  const entries: ProcessNetworkSnapshot['entries'] = [];
  for (const line of last.split(/\r?\n/)) {
    const m = /^(.+)\/(\d+)\/(\d+)\s+([\d.]+)\s+([\d.]+)\s*$/.exec(line);
    if (!m) continue;
    const sent = Number(m[4]) * 1024,
      received = Number(m[5]) * 1024;
    if (!Number.isFinite(sent) || !Number.isFinite(received)) continue;
    entries.push({
      name: m[1].split('/').at(-1)!.slice(0, 256),
      pid: Number(m[2]),
      uid: Number(m[3]),
      sendPerSecond: sent,
      receivePerSecond: received,
    });
  }
  return {
    status: 'ready',
    entries: entries
      .sort((a, b) => b.sendPerSecond + b.receivePerSecond - (a.sendPerSecond + a.receivePerSecond))
      .slice(0, 100),
    sampledAt: Date.now(),
  };
}
