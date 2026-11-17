import {useEffect,useState} from 'react';
import type {ReactNode} from 'react';
import type {RentalSample} from '../../desktop/rental-sample';
const gib=(n:number|null)=>n===null?'未提供':Number((n/2**30).toFixed(2))+' GiB';
export function RentalInformation({sample,closed,diskTools}:{sample:RentalSample;closed:boolean;diskTools:ReactNode}){
 const [section,setSection]=useState('概览');
 const [last,setLast]=useState<RentalSample>(),[percent,setPercent]=useState<number>();
 const [history,setHistory]=useState<number[]>([]);
 useEffect(()=>{
   const delta=last?sample.clock-last.clock:0;
   const value=last&&delta>0&&sample.cpuMicros>=last.cpuMicros?100*(sample.cpuMicros-last.cpuMicros)/(delta*1e6*sample.cores):undefined;
   setPercent(value);if(value!==undefined)setHistory(h=>[...h,value].slice(-30));
   setLast(sample);
 },[sample]);
 const card=(name:string,value:string)=><article><span>{name}</span><strong>{value}</strong></article>;
 return <><nav aria-label="机器信息分类">{['概览','处理器','内存','磁盘','网络','显卡'].map(s=><button key={s} aria-pressed={section===s} onClick={()=>setSection(s)}>{s}</button>)}</nav>
 <p className="machine-freshness">{closed?'连接已断开，显示最后采样':('采集于 '+new Date(sample.at).toLocaleTimeString())} · 实例已运行 {Math.floor(sample.uptime/3600)} 小时 {Math.floor(sample.uptime/60)%60} 分钟</p>
 <div className="machine-stat-grid">{['概览','处理器'].includes(section)&&<>{card('CPU 配额',(sample.planCores??sample.cores)+' 核')}{card('实例 CPU 使用率',closed||percent===undefined?'—':percent.toFixed(1)+'%')}</>}
 {['概览','内存'].includes(section)&&<>{card('实例内存 · 已用 / 配额',gib(sample.used)+' / '+gib(sample.planMemory))}{section==='内存'&&<>{card('套餐剩余内存',gib(sample.planMemory===null?null:Math.max(0,sample.planMemory-sample.used)))}{card('容器内核上限',gib(sample.memory))}</>}</>}
 {['概览','磁盘'].includes(section)&&card('实例存储 · 已用 / 配额',gib(sample.diskUsed)+' / '+gib(sample.disk))}</div>{section==='磁盘'&&diskTools}{['概览','处理器'].includes(section)&&history.length>1&&<><h3>实例 CPU 采样历史</h3><svg className="machine-cpu-history" viewBox="0 0 300 65" role="img" aria-label="按实例配额计算的 CPU 使用率"><polyline fill="none" stroke="#3986d7" strokeWidth="2" points={history.map((v,i)=>[i*300/29,60-Math.min(100,v)*.55].join(',')).join(' ')}/></svg></>}{section==='显卡'&&<p>此租赁套餐未分配 GPU。</p>}{section==='网络'&&<div className="machine-stat-grid">{sample.network.split('\n').filter(Boolean).map(line=>{const [name,rx,tx]=line.split(' ');return <article key={name}><strong>{name}</strong><span>累计接收 {gib(Number(rx))} · 发送 {gib(Number(tx))}</span></article>;})}</div>}</>;
}
