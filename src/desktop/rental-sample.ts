import {z} from 'zod';
import type {ClientProvider} from '../core/client/provider';

// Run only the fixed sampler through the paired machine's existing shell grant.
const sample = String.raw`
set -eu
if ! test -s /home/container/.cagent-start.cjs || ! test -n "$(printenv P_SERVER_UUID)"; then echo CSHELL_NONRENTAL; exit 0; fi
value() { if test -r "$1"; then cat "$1"; else printf '%s' unknown; fi; }
if test -r /sys/fs/cgroup/cpu.max; then
  set -- $(cat /sys/fs/cgroup/cpu.max)
  quota=$1; period=$2
  usage=$(awk '$1=="usage_usec"{print $2}' /sys/fs/cgroup/cpu.stat)
  limit=$(value /sys/fs/cgroup/memory.max)
  used=$(value /sys/fs/cgroup/memory.current)
else
  cpu=/sys/fs/cgroup/cpu
  quota=$(value "$cpu/cpu.cfs_quota_us"); period=$(value "$cpu/cpu.cfs_period_us")
  usage=$(awk '{printf "%.0f", $1/1000}' /sys/fs/cgroup/cpuacct/cpuacct.usage)
  limit=$(value /sys/fs/cgroup/memory/memory.limit_in_bytes)
  used=$(value /sys/fs/cgroup/memory/memory.usage_in_bytes)
fi
up=$(ps -p 1 -o etimes= | tr -d ' ')
awk 'NR>2 && $1!="lo:" {sub(/:$/,"",$1);print "CSHELL_NET",$1,$2,$10}' /proc/net/dev
clock=$(cut -d ' ' -f1 /proc/uptime)
printf 'CSHELL_SAMPLE %s %s %s %s %s %s %s\n' "$quota" "$period" "$usage" "$limit" "$used" "$up" "$clock"
`;
export interface RentalSample {
  planCores:number|null; planMemory:number|null; network:string; cores:number; cpuMicros:number; clock:number; memory:number; used:number; uptime:number;
  disk:number|null; diskUsed:number|null; at:number;
}
export async function readRentalSample(client:ClientProvider,id:string,scanDisk:boolean){
  const command=sample+(scanDisk?"\nif d=$(timeout 4 du -sx -B1 /home/container 2>/dev/null); then printf '%s' \"$d\" | awk '{print \"CSHELL_DISK \" $1}'; fi":"");
  const task=z.object({id:z.string().uuid()}).parse(await client.call(id,{method:'management.script.start',params:{shell:'sh',command,timeoutMs:8000}}));
  const job=z.object({state:z.string(),output:z.string()}).parse(await client.call(id,{method:'management.script.status',params:{id:task.id,waitMs:10000}}));
  if(job.state==='completed'&&job.output.split(/\r?\n/).includes('CSHELL_NONRENTAL'))return null;
  const match=job.output.match(/^CSHELL_SAMPLE (\d+) (\d+) (\d+) (\d+) (\d+) (\d+) ([\d.]+)\s*$/m);
  if(job.state!=='completed'||!match)throw Error('未能读取实例的 cgroup 限额和计数');
  const [quota,period,cpuMicros,memory,used,uptime,clock]=match.slice(1).map(Number);
  if(!(quota>0&&period>0&&memory>0&&memory<Number.MAX_SAFE_INTEGER&&Number.isFinite(clock)))throw Error('实例未提供有效的资源限额');
  const disk=job.output.match(/^CSHELL_DISK (\d+)\s*$/m);
  const network=job.output.split(/\r?\n/).filter(s=>s.startsWith('CSHELL_NET ')).map(s=>s.slice(11)).join('\n'); return {network,cores:quota/period,cpuMicros,clock,memory,used,uptime,diskUsed:disk?Number(disk[1]):null,at:Date.now()};
}
