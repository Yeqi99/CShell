import { quote } from './remote-jobs';

/** Fixed, read-only collection on the authenticated SSH host. It runs in its own
 * channel with the already installed private Node, never in the user's PTY. */
export const linuxMachineSnapshotSource = String.raw`
const os=require('node:os'),{readFile,readdir}=require('node:fs/promises');
const exec=require('node:util').promisify(require('node:child_process').execFile);
(async()=>{
 if(process.platform!=='linux')throw Error('SSH 机器信息采集只支持 Linux');
 const result={at:Date.now(),hostname:os.hostname(),platform:process.platform,release:os.release(),arch:os.arch(),uptime:os.uptime(),source:'ssh',
  cpu:os.cpus().map(c=>({model:c.model,mhz:c.speed,user:c.times.user,sys:c.times.sys,idle:c.times.idle,total:Object.values(c.times).reduce((a,b)=>a+b,0)})),
  memory:{total:os.totalmem(),free:os.freemem(),available:os.freemem()},
  network:Object.entries(os.networkInterfaces()).map(([name,addresses])=>({name,addresses:(addresses||[]).map(a=>a.address)})),
  disks:'',processes:'',ports:'',gpu:'',errors:{}};
 try{
  const memory=await readFile('/proc/meminfo','utf8');
  const value=name=>{const match=memory.match(new RegExp('^'+name+':\\s+(\\d+)','m'));return match?Number(match[1])*1024:undefined;};
  for(const [key,name] of Object.entries({available:'MemAvailable',cached:'Cached',buffers:'Buffers',swapTotal:'SwapTotal',swapFree:'SwapFree'})){const v=value(name);if(v!==undefined)result.memory[key]=v;}
 }catch{result.errors.memory='部分 /proc 内存数据不可读';}
 try{
  for(const row of (await readFile('/proc/net/dev','utf8')).split('\n').slice(2)){
   const [name,rest]=row.trim().split(':');if(!rest)continue;const numbers=rest.trim().split(/\s+/).map(Number),target=result.network.find(n=>n.name===name);
   if(target){target.received=numbers[0];target.sent=numbers[8];}
  }
 }catch{result.errors.network='系统未提供网卡流量计数';}
 try{
  const stat=(await readFile('/proc/stat','utf8')).split('\n')[0].trim().split(/\s+/).slice(1).map(Number),temperatures=[];
  for(const name of (await readdir('/sys/class/thermal').catch(()=>[])).filter(n=>/^thermal_zone\d+$/.test(n)).slice(0,16)){
   try{const root='/sys/class/thermal/'+name,celsius=Number(await readFile(root+'/temp','utf8'))/1000;if(Number.isFinite(celsius)&&celsius>-50&&celsius<200)temperatures.push({name:(await readFile(root+'/type','utf8')).trim(),celsius});}catch{}
  }
  result.cpuDetails={user:stat[0]+stat[1],sys:stat[2],idle:stat[3],iowait:stat[4],total:stat.slice(0,8).reduce((a,b)=>a+b,0),load:os.loadavg(),temperatures};
 }catch{result.errors.cpu='部分 CPU 计数不可读';}
 try{result.diskIo=(await readFile('/proc/diskstats','utf8')).trim().split('\n').map(line=>line.trim().split(/\s+/)).filter(v=>!v[2].startsWith('loop')&&!v[2].startsWith('ram')).slice(0,64).map(v=>({name:v[2],readBytes:Number(v[5])*512,writtenBytes:Number(v[9])*512}));}catch{result.errors.diskIo='磁盘计数不可读';}
 async function command(key,file,args){try{result[key]=(await exec(file,args,{timeout:8000,maxBuffer:256*1024,encoding:'utf8'})).stdout.trim();}catch{result.errors[key]='系统未提供此数据、工具不可用或当前权限不足';}}
 await Promise.all([command('disks','df',['-hPT']),command('processes','ps',['-eo','pid,comm,%mem,%cpu','--sort=-%mem']),command('ports','ss',['-lntu']),command('gpu','nvidia-smi',['--query-gpu=name,memory.used,memory.total,temperature.gpu,power.draw','--format=csv,noheader'])]);
 result.processes=result.processes.split('\n').slice(0,32).join('\n');
 process.stdout.write(JSON.stringify(result));
})().catch(()=>{process.stderr.write('无法读取当前 SSH 机器的信息');process.exitCode=1;});
`;

export const linuxMachineSnapshotPython = String.raw`
import os, sys, json, socket, platform, time, pathlib, subprocess
from concurrent.futures import ThreadPoolExecutor
if sys.platform != 'linux':
    raise SystemExit('SSH machine collection requires Linux')
errors = {}
def read(path):
    return pathlib.Path(path).read_text(errors='replace')
def command(key, args):
    try:
        result = subprocess.run(args, capture_output=True, timeout=8, check=True)
        return result.stdout[:262144].decode('utf-8', errors='replace').strip()
    except Exception:
        errors[key] = '系统未提供此数据、工具不可用或当前权限不足'
        return ''
memory = {}
for line in read('/proc/meminfo').splitlines():
    key, value = line.split(':', 1)
    memory[key] = int(value.strip().split()[0])*1024
cpuinfo = []
for block in read('/proc/cpuinfo').strip().split('\n\n'):
    cpuinfo.append(dict((key.strip(), value.strip()) for key, value in (line.split(':',1) for line in block.splitlines() if ':' in line)))
ticks = os.sysconf('SC_CLK_TCK')
cpus = []
stat = read('/proc/stat').splitlines()
for line in stat:
    parts = line.split()
    if not parts[0].startswith('cpu') or not parts[0][3:].isdigit():
        continue
    n = int(parts[0][3:]); values = [int(value)*1000/ticks for value in parts[1:9]]
    info = cpuinfo[n] if n < len(cpuinfo) else {}
    cpus.append(dict(model=info.get('model name',info.get('Processor',info.get('Hardware','型号未提供'))), mhz=float(info.get('cpu MHz','0')),user=values[0],sys=values[2],idle=values[3],total=sum(values)))
interfaces = []
addresses = {}
commands=dict(network=['ip','-j','address','show'],disks=['df','-hPT'],processes=['ps','-eo','pid,comm,%mem,%cpu','--sort=-%mem'],ports=['ss','-lntu'],gpu=['nvidia-smi','--query-gpu=name,memory.used,memory.total,temperature.gpu,power.draw','--format=csv,noheader'])
with ThreadPoolExecutor(max_workers=5) as pool:
    pending={key:pool.submit(command,key,args) for key,args in commands.items()}
    outputs={key:future.result() for key,future in pending.items()}
ip = outputs['network']
if ip:
    try:
        addresses = {row['ifname']:[entry['local'] for entry in row.get('addr_info',[]) if 'local' in entry] for row in json.loads(ip)}
    except Exception:
        errors['network']='系统未提供网卡地址'
for line in read('/proc/net/dev').splitlines()[2:]:
    name, raw=line.strip().split(':',1); values=raw.split()
    interfaces.append(dict(name=name,addresses=addresses.get(name,[]),received=int(values[0]),sent=int(values[8])))
temperatures=[]
for root in list(pathlib.Path('/sys/class/thermal').glob('thermal_zone*'))[:16]:
    try:
        value=float(read(root/'temp'))/1000
        if -50<value<200:
            temperatures.append(dict(name=read(root/'type').strip(),celsius=value))
    except Exception:
        pass
total=[int(v) for v in stat[0].split()[1:9]]
disks=[]
try:
    for line in read('/proc/diskstats').splitlines():
        v=line.split()
        if not v[2].startswith(('loop','ram')):
            disks.append(dict(name=v[2],readBytes=int(v[5])*512,writtenBytes=int(v[9])*512))
except Exception:
    errors['diskIo']='磁盘计数不可读'
snapshot=dict(at=int(time.time()*1000),hostname=socket.gethostname(),platform='linux',release=platform.release(),arch={'x86_64':'x64','aarch64':'arm64'}.get(platform.machine(),platform.machine()),uptime=float(read('/proc/uptime').split()[0]),source='ssh',cpu=cpus,
    memory=dict(total=memory['MemTotal'],free=memory['MemFree'],available=memory.get('MemAvailable',memory['MemFree']),cached=memory.get('Cached',0),buffers=memory.get('Buffers',0),swapTotal=memory.get('SwapTotal',0),swapFree=memory.get('SwapFree',0)),network=interfaces,
    cpuDetails=dict(user=total[0]+total[1],sys=total[2],idle=total[3],iowait=total[4],total=sum(total),load=list(os.getloadavg()),temperatures=temperatures),diskIo=disks[:64],
    disks=outputs['disks'],processes='\n'.join(outputs['processes'].splitlines()[:32]),ports=outputs['ports'],gpu=outputs['gpu'],errors=errors)
print(json.dumps(snapshot,ensure_ascii=False,separators=(',',':')))
`;

export const linuxMachineSnapshotCommand = `if test -x "$HOME/.local/share/cagent/cshell/current/runtime/bin/node"; then
exec "$HOME/.local/share/cagent/cshell/current/runtime/bin/node" -e ${quote(linuxMachineSnapshotSource)}
else
exec python3 -c ${quote(linuxMachineSnapshotPython)}
fi`;
