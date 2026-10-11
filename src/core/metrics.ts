const baseMetricsCommand =
  "LC_ALL=C; export LC_ALL; printf '__CPU__\\n'; awk '/^cpu / {print} /^cpu[0-9]+ / {n++} END {printf \"__CORES__ %d\\n\", n}' /proc/stat; printf '__MEM__\\n'; cat /proc/meminfo; printf '__DISK__\\n'; df -Pk / | tail -n 1";
export type CpuSample = { total: number; idle: number };
export const metricsCommand =
  baseMetricsCommand +
  "; printf '__MODEL__\\n'; awk -F ': ' '/^(model name|Hardware|Processor)[[:space:]]*:/ {print $2; exit}' /proc/cpuinfo";
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
  };
}
