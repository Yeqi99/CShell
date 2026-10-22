import { networkProbeSchema, type NetworkProbeResult } from '../shared/network-probe';
import { RemoteJobs, quote } from './remote-jobs';
import type { SshService } from './ssh';
// Fixed program; all target values are JSON arguments, never interpolated code.
const program = `import json,socket,sys,time
c=json.loads(sys.argv[1]); samples=[]; started=int(time.time()*1000)
for _ in range(c['samples']):
 t=time.monotonic(); s=None
 try:
  s=socket.create_connection((c['host'].strip('[]'),c['port']),c['timeoutMs']/1000)
  samples.append({'elapsedMs':round((time.monotonic()-t)*1000,2)})
 except OSError:
  samples.append({'elapsedMs':None,'error':'目标端口不可达、解析失败或连接超时'})
 finally:
  if s is not None: s.close()
times=[s['elapsedMs'] for s in samples if s['elapsedMs'] is not None]
print(json.dumps({'method':'tcp-connect','host':c['host'],'port':c['port'],'startedAt':started,'samples':samples,'minimumMs':min(times) if times else None,'averageMs':round(sum(times)/len(times),2) if times else None,'maximumMs':max(times) if times else None,'failed':len(samples)-len(times)}))
`;
export async function probeSshNetwork(ssh: SshService, sessionId: string, input: unknown, signal: AbortSignal): Promise<NetworkProbeResult> {
  const config = networkProbeSchema.parse(input);
  const command = 'command -v python3 >/dev/null 2>&1 || { printf "需要 Python 3 或 CAgent 执行网络检测\\n" >&2; exit 1; }; python3 -c ' + quote(program) + ' ' + quote(JSON.stringify(config));
  const output = await new RemoteJobs(ssh).exec(sessionId, command, undefined, 28000, undefined, signal);
  const value = JSON.parse(output.trim());
  // Remote output is validated again by the desktop coordinator.
  return value;
}
