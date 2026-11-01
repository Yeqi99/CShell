import { useEffect, useRef, useState } from 'react';
import { Activity } from 'lucide-react';
import type { Profile } from '../../shared/contracts';

export function PingAll({profiles, interval = 0, onInterval}:{profiles:Profile[]; interval?:number; onInterval?:(value:number)=>Promise<void>}) {
  const [busy,setBusy]=useState(false),[menu,setMenu]=useState(false);
  const [error,setError]=useState('');
  const running=useRef(false),current=useRef(profiles),alive=useRef(true);
  current.current=profiles;
  useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[]);
  const ping=async()=>{
    if(running.current)return;running.current=true;setBusy(true);
    const queue=current.current.filter(p=>p.protocol!=='http');
    let index=0;
    const worker=async()=>{while(alive.current&&index<queue.length){const profile=queue[index++];try{
      const result=await window.cshell.networkPing({profileId:profile.id});
      if(alive.current)window.dispatchEvent(new CustomEvent('cshell:ping-result',{detail:{profileId:profile.id,result}}));
    }catch(cause){if(alive.current)window.dispatchEvent(new CustomEvent('cshell:ping-result',{detail:{profileId:profile.id,error:cause instanceof Error?cause.message:'检测未完成'}}));}}};
    try{await Promise.all([worker(),worker()]);}finally{running.current=false;if(alive.current)setBusy(false);}
  };
  useEffect(()=>{if(!interval)return;const timer=window.setInterval(()=>void ping(),interval*1000);return()=>window.clearInterval(timer);},[interval]);
  return <span className="ping-all-control">
    <button type="button" disabled={busy} aria-label="本机 Ping 全部服务器" title={busy?'正在检测服务器':'Ping 全部 · 右键设置自动检测'} onClick={()=>void ping()} onContextMenu={e=>{e.preventDefault();setMenu(v=>!v)}} onKeyDown={e=>{if(e.key==='Escape')setMenu(false);if(e.key==='ContextMenu'||e.shiftKey&&e.key==='F10'){e.preventDefault();setMenu(v=>!v)}}}><Activity size={13}/>{busy?'检测中':'Ping 全部'}</button>
    {menu&&<span className="ping-all-menu"><label>自动检测<select aria-label="自动 Ping 间隔" value={interval} disabled={!onInterval} onChange={e=>{setError('');void onInterval?.(Number(e.target.value)).catch(cause=>setError(cause instanceof Error?cause.message:'保存失败'));}}><option value={0}>关闭</option><option value={30}>每 30 秒</option><option value={60}>每分钟</option><option value={300}>每 5 分钟</option></select></label>{error&&<small role="alert">{error}</small>}<button type="button" onClick={()=>setMenu(false)}>完成</button></span>}
  </span>;
}
