import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { MachineSnapshot } from '../../agent/machine-info';
import type { AgentCall } from '../../shared/agent';
import './machine-information.css';
const size=(bytes:number)=>Number.isFinite(bytes)?`${(bytes/1024**3).toFixed(1)} GB`:'—';
const sections=[['overview','概览'],['cpu','处理器'],['memory','内存'],['disks','磁盘'],['network','网络'],['gpu','显卡']] as const;
export function MachineInformation({call,active,closed}:{call:(method:AgentCall['method'],params?:unknown)=>Promise<unknown>;active:boolean;closed:boolean}) {
  const [snapshot,setSnapshot]=useState<MachineSnapshot>(),[section,setSection]=useState<string>('overview'),[error,setError]=useState(''),[busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0);
  const previous=useRef<MachineSnapshot | undefined>(undefined),history=useRef<number[]>([]);
  const [load,setLoad]=useState<number[]>();
  useEffect(()=>{
    if(!active||closed)return;
    let disposed=false,timer:ReturnType<typeof setTimeout>;
    const read=async()=>{
      setBusy(true);
      try{
        const next=await call('machine.snapshot',{}) as MachineSnapshot;
        if(disposed)return;
        const old=previous.current;
        const values=old&&next.cpu.length===old.cpu.length?next.cpu.map((c,i)=>{const total=c.total-old.cpu[i].total;return total>0?Math.max(0,Math.min(100,100*(1-(c.idle-old.cpu[i].idle)/total))):0;}):undefined;
        setLoad(values);if(values?.length)history.current=[...history.current,values.reduce((a,b)=>a+b,0)/values.length].slice(-30);
        previous.current=next;setSnapshot(next);setError('');
      }catch(e){if(!disposed){setError(e instanceof Error?e.message:String(e));setLoad(undefined);}}
      finally{if(!disposed){setBusy(false);timer=setTimeout(()=>void read(),4000);}}
    };
    void read();return()=>{disposed=true;clearTimeout(timer);};
  },[call,active,closed,refresh]);
  const cpu=load?.length?load.reduce((a,b)=>a+b,0)/load.length:undefined;
  const current=!closed&&!error;
  const detail=(key:'disks'|'ports'|'processes'|'gpu')=><pre>{snapshot?.[key]||snapshot?.errors[key]||'暂无数据'}</pre>;
  return <section className="machine-information">
    <header><div><strong>{snapshot?.hostname??'机器信息'}</strong><small>{snapshot?`${snapshot.platform} · ${snapshot.arch} · ${snapshot.release}`:'正在读取目标机器'}</small></div><button className="icon" title="刷新机器信息" aria-label="刷新机器信息" disabled={busy||closed} onClick={()=>setRefresh(n=>n+1)}><RefreshCw size={16}/></button></header>
    <nav aria-label="机器信息分类">{sections.map(([id,label])=><button key={id} aria-pressed={section===id} onClick={()=>setSection(id)}>{label}</button>)}</nav>
    <p className="machine-freshness" role="status">{closed?'连接已断开，以下为最后采集数据':error?`采集失败：${error}`:snapshot?`采集于 ${new Date(snapshot.at).toLocaleTimeString()} · 运行 ${(snapshot.uptime/86400).toFixed(1)} 天`:busy?'正在采集…':'等待采集'}</p>
    {snapshot&&<div className="machine-information-body">
      {['overview','cpu'].includes(section)&&<><div className="machine-stat-grid"><article><span>CPU · {snapshot.cpu.length} 逻辑核心</span><strong>{current&&cpu!==undefined?cpu.toFixed(1)+'%':'—'}</strong><small>{snapshot.cpu[0]?.model||'型号不可用'}</small></article><article><span>内存 · 已用 / 总量</span><strong>{size(snapshot.memory.total-snapshot.memory.available)}</strong><small>/ {size(snapshot.memory.total)}</small></article></div><h3>CPU 采样历史</h3><svg viewBox="0 0 300 65" role="img" aria-label="CPU 最近采样历史，纵轴 0 至 100%"><path d="M0 5H300 M0 60H300" stroke="currentColor" opacity=".15"/>{history.current.length>1&&<polyline fill="none" stroke="#3986d7" strokeWidth="2" points={history.current.map((v,i)=>`${i*300/29},${60-v*.55}`).join(' ')}/>}</svg></>}
      {section==='cpu'&&<div className="machine-core-grid">{snapshot.cpu.map((c,i)=><article key={i}><span>核心 {i+1}</span><strong>{current&&load?load[i].toFixed(0)+'%':'—'}</strong><small>{c.mhz} MHz</small></article>)}</div>}
      {section==='memory'&&<><div className="machine-stat-grid">{Object.entries({可用:snapshot.memory.available,空闲:snapshot.memory.free,缓存:snapshot.memory.cached,缓冲:snapshot.memory.buffers,交换区总量:snapshot.memory.swapTotal,交换区空闲:snapshot.memory.swapFree}).map(([label,value])=><article key={label}><span>{label}</span><strong>{value===undefined?'未提供':size(value)}</strong></article>)}</div><h3>进程内存排行</h3>{detail('processes')}</>}
      {section==='disks'&&<><h3>文件系统容量</h3>{detail('disks')}</>}
      {section==='network'&&<><div className="machine-stat-grid">{snapshot.network.map(n=><article key={n.name}><strong>{n.name}</strong><small>{n.addresses.join(' · ')}</small><span>{n.received===undefined?'流量计数未提供':`累计接收 ${size(n.received)} · 发送 ${size(n.sent!)}`}</span></article>)}</div><h3>监听端口</h3>{detail('ports')}</>}
      {section==='gpu'&&<><h3>显卡与驱动</h3>{detail('gpu')}</>}
    </div>}
  </section>;
}
