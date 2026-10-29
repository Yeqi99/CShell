import type { NetworkMetrics } from '../shared/network-metrics';
export type NetworkSample = { uptime: number; interfaces: { name: string; counters: number[] }[] };
export const networkMetricsCommand =
  "; printf '__NETWORK__\\n'; cat /proc/uptime 2>/dev/null; cat /proc/net/dev 2>/dev/null; printf '__NETWORK_END__\\n'";
export function parseNetworkMetrics(
  output: string,
  previous?: NetworkSample,
): { network: NetworkMetrics; sample?: NetworkSample } {
  const section = output.split('__NETWORK__')[1]?.split('__NETWORK_END__')[0]?.trim();
  const uptime = Number(section?.split(/\s+/)[0]);
  const interfaces: NetworkSample['interfaces'] = [];
  for (const line of section?.split('\n').slice(1) || []) {
    const match = /^\s*([^:\s]+):\s+(.+)$/.exec(line);
    if (!match) continue;
    const counters = match[2].trim().split(/\s+/).map(Number);
    if (counters.length !== 16 || counters.some((n) => !Number.isSafeInteger(n) || n < 0)) continue;
    interfaces.push({ name: match[1], counters });
  }
  if (!section || !Number.isFinite(uptime) || !interfaces.length)
    return { network: { status: 'unavailable', interfaces: [], sampledAt: Date.now() } };
  const elapsed = previous ? uptime - previous.uptime : 0;
  const rows = interfaces.map(({ name, counters: c }) => {
    const before = previous?.interfaces.find((row) => row.name === name)?.counters;
    const valid = before && elapsed > 0 && elapsed <= 30 && c[0] >= before[0] && c[8] >= before[8];
    return {
      name,
      rxBytes: c[0],
      txBytes: c[8],
      rxPackets: c[1],
      txPackets: c[9],
      rxErrors: c[2],
      txErrors: c[10],
      rxDropped: c[3],
      txDropped: c[11],
      receivePerSecond: valid ? (c[0] - before![0]) / elapsed : null,
      sendPerSecond: valid ? (c[8] - before![8]) / elapsed : null,
    };
  });
  return {
    sample: { uptime, interfaces },
    network: {
      status: rows.some((row) => row.receivePerSecond !== null) ? 'ready' : 'sampling',
      interfaces: rows,
      sampledAt: Date.now(),
    },
  };
}
