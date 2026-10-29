import { networkMetricsCommand } from './network-metrics';
const baseMetricsCommand =
  "LC_ALL=C; export LC_ALL; printf '__CPU__\\n'; awk '/^cpu / {print} /^cpu[0-9]+ / {n++} END {printf \"__CORES__ %d\\n\", n}' /proc/stat; printf '__MEM__\\n'; cat /proc/meminfo; printf '__DISK__\\n'; df -Pk";
export type CpuSample = { total: number; idle: number };
const systemMetricsCommand =
  baseMetricsCommand +
  "; printf '__DRIVES__\\n'; lsblk -b -d -n -o NAME,SIZE,TYPE 2>/dev/null; printf '__MODEL__\\n'; " +
  "model=$(awk -F: '/^model name[[:space:]]*:/ {sub(/^[[:space:]]+/,\"\",$2); print $2; exit}' /proc/cpuinfo); " +
  "if [ -z \"$model\" ]; then model=$(lscpu 2>/dev/null | awk -F: '/^Model name[[:space:]]*:/ {sub(/^[[:space:]]+/,\"\",$2); if (!seen[$2]++) {printf \"%s%s\", sep, $2; sep=\" + \"}}'); fi; " +
  "if [ -z \"$model\" ]; then model=$(awk -F: '/^(Hardware|Processor)[[:space:]]*:/ {sub(/^[[:space:]]+/,\"\",$2);print $2;exit}' /proc/cpuinfo); fi; printf '%s\\n' \"$model\"";
export function parseMetrics(output: string, previous?: CpuSample) {
  const cpuLine = output.match(/^cpu\s+(.+)$/m);
  const values = cpuLine?.[1].trim().split(/\s+/).map(Number).slice(0, 8);
  const sample =
    values && values.length >= 4 && values.every(Number.isFinite)
      ? { total: values.reduce((a, b) => a + b, 0), idle: values[3] + (values[4] || 0) }
      : undefined;
  const cpu =
    sample && previous && sample.total > previous.total
      ? Math.max(
          0,
          Math.min(
            100,
            100 * (1 - (sample.idle - previous.idle) / (sample.total - previous.total)),
          ),
        )
      : null;
  const total = Number(output.match(/MemTotal:\s+(\d+)/)?.[1]);
  const available = Number(output.match(/MemAvailable:\s+(\d+)/)?.[1]);
  const reportedCount = Number(output.match(/^__CORES__ (\d+)$/m)?.[1]);
  const cpuCount =
    reportedCount > 0 ? reportedCount : (output.match(/^cpu\d+\s/gm)?.length ?? null);
  const validMemory =
    total > 0 && Number.isFinite(available) && available >= 0 && available <= total;
  const disk = output.split('__DISK__')[1]?.match(/^\S+\s+(\d+)\s+(\d+)\s+(-?\d+)\s+(\d+)%\s+\/$/m);
  const diskTotal = disk ? Number(disk[1]) : NaN;
  const diskUsed = disk ? Number(disk[2]) : NaN;
  const validDisk = diskTotal > 0 && diskUsed >= 0 && diskUsed <= diskTotal;
  const disks: { device: string; mount: string; total: number; used: number; percent: number }[] = [];
  const seen = new Set<string>();
  for (const line of (output.split('__DISK__')[1]?.split('__MODEL__')[0] || '').split(/\r?\n/)) {
    const row = line.match(/^(\S+)\s+(\d+)\s+(\d+)\s+(-?\d+)\s+(\d+)%\s+(.+)$/);
    if (!row || (!row[1].startsWith('/dev/') && row[6] !== '/') || seen.has(row[1])) continue;
    const total = Number(row[2]) * 1024, used = Number(row[3]) * 1024;
    if (!Number.isSafeInteger(total) || total <= 0 || used < 0 || used > total) continue;
    seen.add(row[1]);
    disks.push({ device: row[1], mount: row[6].replace(/\\040/g, ' '), total, used, percent: Number(row[5]) });
  }
  return {
    sample,
    cpu,
    cpuCount,
    cpuModel:
      output
        .match(/^__MODEL__\r?\n([^\r\n]+)/m)?.[1]
        .trim()
        .slice(0, 256) || null,
    memory: validMemory ? (1 - available / total) * 100 : null,
    memoryUsed: validMemory ? (total - available) * 1024 : null,
    memoryTotal: total > 0 ? total * 1024 : null,
    disk: validDisk ? Number(disk![4]) : null,
    diskUsed: validDisk ? diskUsed * 1024 : null,
    diskTotal: validDisk ? diskTotal * 1024 : null,
    disks,
    physicalDisks: (output.split('__DRIVES__')[1]?.split('__MODEL__')[0] || '').split(/\r?\n/).flatMap(line => {
      const match = line.trim().match(/^(\S+)\s+(\d+)\s+disk$/);
      const size = match ? Number(match[2]) : 0;
      return match && Number.isSafeInteger(size) && size > 0 ? [{name: match[1], size}] : [];
    }),
  };
}

export const metricsCommand = systemMetricsCommand + networkMetricsCommand;
