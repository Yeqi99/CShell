import { parseProcessNetwork, processNetworkCommand } from './process-network';
import type { HardwareInfo, ProcessSnapshot } from '../shared/resources';
import { RemoteJobs } from './remote-jobs';
import type { SshService } from './ssh';

const hardwareCommand = `LC_ALL=C; export LC_ALL
if command -v nvidia-smi >/dev/null 2>&1; then
  printf '__NVIDIA__\\n'
  nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits 2>/dev/null || true
fi
if command -v lspci >/dev/null 2>&1; then
  printf '__PCI__\\n'
  lspci 2>/dev/null | grep -Ei 'VGA compatible controller|3D controller|Display controller' || true
fi`;
// Use comm, not args: process arguments may contain passwords or access tokens.
const processCommand = 'LC_ALL=C ps -eo pid=,user=,pcpu=,pmem=,comm= --sort=-pcpu | head -n 501';
export function parseHardware(output: string): HardwareInfo {
  const bounded = (s: string, max: number) => {
    const n = Number(s.trim());
    return s.trim() && Number.isFinite(n) && n >= 0 && n <= max ? n : null;
  };
  const gpus = (output.split('__NVIDIA__')[1]?.split('__PCI__')[0] || '')
    .split('\n')
    .flatMap((line) => {
      const columns = line.split(',');
      if (columns.length !== 4) return [];
      const [name, cpu, used, total] = columns;
      if (!name.trim()) return [];
      return [
        {
          name: name.trim(),
          utilization: bounded(cpu, 100),
          memoryUsed: bounded(used, 1e9),
          memoryTotal: bounded(total, 1e9),
        },
      ];
    });
  // PCI inventory includes integrated/AMD/virtual adapters; utilization is not fabricated.
  const pci = (output.split('__PCI__')[1] || '')
    .split('\n')
    .filter((line) => /(?:VGA compatible|3D|Display) controller:/.test(line));
  for (const line of pci) {
    if (gpus.length && /NVIDIA/i.test(line)) continue;
    gpus.push({
      name: line.replace(/^.*?controller:\s*/, '').trim(),
      utilization: null,
      memoryUsed: null,
      memoryTotal: null,
    });
  }
  return { gpus: gpus.slice(0, 32), status: gpus.length ? 'detected' : 'unavailable' };
}
export function parseProcesses(output: string): ProcessSnapshot {
  const rows = output.trim().split('\n').filter(Boolean);
  const entries = rows.slice(0, 500).map((line) => {
    const match = line.trim().match(/^(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(.+)$/);
    if (!match) throw new Error('Process listing is not supported on this system');
    return {
      pid: Number(match[1]),
      user: match[2],
      cpu: Number(match[3]),
      memory: Number(match[4]),
      command: match[5],
    };
  });
  if (!entries.length) throw new Error('Process listing unavailable');
  return { entries, sampledAt: Date.now(), truncated: rows.length > 500 };
}
export class ResourceInspection {
  private jobs: RemoteJobs;
  private pending = new Map<string, Promise<string>>();
  constructor(ssh: SshService) {
    this.jobs = new RemoteJobs(ssh);
  }
  private async run(sessionId: string, kind: string, command: string) {
    const key = sessionId + ':' + kind;
    const existing = this.pending.get(key);
    if (existing) return existing;
    const request = this.jobs.exec(sessionId, command, undefined, 8000);
    this.pending.set(key, request);
    try {
      return await request;
    } finally {
      this.pending.delete(key);
    }
  }
  async processNetwork(sessionId: string) {
    return parseProcessNetwork(await this.run(sessionId, 'process-network', processNetworkCommand));
  }
  async hardware(sessionId: string) {
    return parseHardware(await this.run(sessionId, 'hardware', hardwareCommand));
  }
  async processes(sessionId: string) {
    return parseProcesses(await this.run(sessionId, 'processes', processCommand));
  }
}
