export interface GpuInfo {
  name: string;
  utilization: number | null;
  memoryUsed: number | null;
  memoryTotal: number | null;
}
export interface HardwareInfo {
  gpus: GpuInfo[];
  status: 'detected' | 'unavailable';
}
export interface ProcessInfo {
  pid: number;
  user: string;
  cpu: number;
  memory: number;
  command: string;
}
export interface ProcessSnapshot {
  entries: ProcessInfo[];
  sampledAt: number;
  truncated: boolean;
}
