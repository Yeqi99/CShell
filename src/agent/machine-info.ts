import * as os from 'node:os';
import { readFile, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
export type MachineSnapshot = {
  at: number; hostname: string; platform: string; release: string; arch: string; uptime: number;
  cpu: { model: string; mhz: number; user: number; sys: number; idle: number; total: number }[];
  memory: { total: number; free: number; available: number; cached?: number; buffers?: number; swapTotal?: number; swapFree?: number };
  network: { name: string; addresses: string[]; received?: number; sent?: number }[];
  cpuDetails?: {user:number;sys:number;idle:number;iowait:number;total:number;load:number[];temperatures:{name:string;celsius:number}[]};
  diskIo?: {name:string;readBytes:number;writtenBytes:number}[];
  disks: string; processes: string; ports: string; gpu: string; errors: Record<string, string>;
};
let inFlight = 0;
export async function machineSnapshot(signal?: AbortSignal): Promise<MachineSnapshot> {
  if(inFlight >= 2) throw new Error('机器信息采集正在进行');
  inFlight++;
  try { return await collectSnapshot(signal); } finally { inFlight--; }
}
async function collectSnapshot(signal?: AbortSignal): Promise<MachineSnapshot> {
  const result: MachineSnapshot = { at: Date.now(), hostname: os.hostname(), platform: process.platform, release: os.release(), arch: os.arch(), uptime: os.uptime(),
    cpu: os.cpus().map(cpu => ({ model: cpu.model, mhz: cpu.speed, user: cpu.times.user, sys: cpu.times.sys, idle: cpu.times.idle, total: Object.values(cpu.times).reduce((a,b)=>a+b,0) })),
    memory: { total: os.totalmem(), free: os.freemem(), available: os.freemem() },
    network: Object.entries(os.networkInterfaces()).map(([name, addresses]) => ({ name, addresses: (addresses ?? []).map(a => a.address) })),
    disks: '', processes: '', ports: '', gpu: '', errors: {},
  };
  const command = async (key: 'disks'|'processes'|'ports'|'gpu', file: string, args: string[]) => {
    try { result[key] = (await exec(file,args,{timeout:10000,maxBuffer:256*1024,windowsHide:true,signal,encoding:'utf8'})).stdout.trim(); }
    catch { result.errors[key] = '系统未提供此数据、工具不可用或当前权限不足'; }
  };
  if (process.platform === 'linux') {
    try {
      const memory = await readFile('/proc/meminfo','utf8');
      const value = (name:string) => Number(memory.match(new RegExp('^'+name+':\\s+(\\d+)', 'm'))?.[1] ?? 0)*1024;
      Object.assign(result.memory,{available:value('MemAvailable'),cached:value('Cached'),buffers:value('Buffers'),swapTotal:value('SwapTotal'),swapFree:value('SwapFree')});
      const network = await readFile('/proc/net/dev','utf8');
      for (const row of network.split('\n').slice(2)) {
        const [name, rest] = row.trim().split(':'); if (!rest) continue;
        const numbers=rest.trim().split(/\s+/).map(Number), target=result.network.find(n=>n.name===name);
        if(target){target.received=numbers[0];target.sent=numbers[8];}
      }
    } catch { result.errors.memory='部分 /proc 数据不可读'; }
    try {
      const stat=(await readFile('/proc/stat','utf8')).split('\n')[0].trim().split(/\s+/).slice(1).map(Number);
      const temperatures:{name:string;celsius:number}[]=[];
      for(const name of (await readdir('/sys/class/thermal').catch(()=>[])).filter(n=>/^thermal_zone\d+$/.test(n)).slice(0,16)){
        try{const root='/sys/class/thermal/'+name;const celsius=Number(await readFile(root+'/temp','utf8'))/1000;if(Number.isFinite(celsius)&&celsius>-50&&celsius<200)temperatures.push({name:(await readFile(root+'/type','utf8')).trim(),celsius});}catch{}
      }
      result.cpuDetails={user:stat[0]+stat[1],sys:stat[2],idle:stat[3],iowait:stat[4],total:stat.slice(0,8).reduce((a,b)=>a+b,0),load:os.loadavg(),temperatures};
      result.diskIo=(await readFile('/proc/diskstats','utf8')).trim().split('\n').map(line=>line.trim().split(/\s+/)).filter(v=>!v[2].startsWith('loop')&&!v[2].startsWith('ram')).slice(0,64).map(v=>({name:v[2],readBytes:Number(v[5])*512,writtenBytes:Number(v[9])*512}));
    }catch{result.errors.cpu='部分 CPU 或磁盘计数不可读';}
    await Promise.all([
      command('disks','df',['-hPT']),
      command('processes','ps',['-eo','pid,comm,%mem,%cpu','--sort=-%mem']),
      command('ports','ss',['-lntu']),
      command('gpu','nvidia-smi',['--query-gpu=name,memory.used,memory.total,temperature.gpu,power.draw','--format=csv,noheader']),
    ]);
  } else if (process.platform === 'win32') {
    const ps = (key:'disks'|'processes'|'ports'|'gpu', source:string) => command(key,'powershell.exe',['-NoProfile','-NonInteractive','-Command','[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;'+source]);
    await Promise.all([
      ps('disks', 'Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,Size,FreeSpace,FileSystem | Format-Table -AutoSize'),
      ps('processes','Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 30 Id,ProcessName,WorkingSet64,CPU | Format-Table -AutoSize'),
      ps('ports','Get-NetTCPConnection -State Listen | Select-Object -First 100 LocalAddress,LocalPort,OwningProcess | Format-Table -AutoSize'),
      ps('gpu','Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion | Format-List'),
      (async()=>{try{const output=await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command','[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;Get-NetAdapterStatistics | Select-Object Name,ReceivedBytes,SentBytes | ConvertTo-Json -Compress'],{timeout:10000,maxBuffer:128*1024,windowsHide:true,signal,encoding:'utf8'});const data=JSON.parse(output.stdout);for(const row of Array.isArray(data)?data:[data]){const n=result.network.find(n=>n.name===row.Name);if(n&&Number.isFinite(row.ReceivedBytes)&&Number.isFinite(row.SentBytes)){n.received=row.ReceivedBytes;n.sent=row.SentBytes;}}}catch{result.errors.network='系统未提供网卡流量计数';}})(),
    ]);
  } else {
    await command('disks','df',['-h']);
    result.errors.processes=result.errors.ports=result.errors.gpu='此平台尚未接入详细采集';
  }
  result.processes=result.processes.split('\n').slice(0,32).join('\n');
  signal?.throwIfAborted();
  return result;
}
