import {Monitor, LoaderCircle, AlertCircle, Unplug, ArrowRight} from 'lucide-react';
import './machine-connection-state.css';

export function MachineConnectionState({name, phase, error, details, primary, secondary}: {
  name:string; phase:'checking'|'connecting'|'installing'|'error'|'closed'; error?:string; details?:string;
  primary?:{label:string;run:()=>void}; secondary?:{label:string;run:()=>void};
}) {
  const pending=['checking','connecting','installing'].includes(phase);
  const labels={checking:'正在检查工作区',connecting:'正在连接 CAgent',installing:'正在准备工作区',error:'暂时无法打开工作区',closed:'连接已断开'};
  return <section className="machine-connection-state" aria-label="机器连接状态" aria-busy={pending}>
    <div className="machine-connection-card">
      <div className="machine-connection-emblem"><Monitor size={30}/></div>
      <h1>{name}</h1>
      <p className="machine-connection-phase" role={phase==='error'?'alert':'status'}>{pending?<LoaderCircle className="machine-connection-spinner" size={17}/>:phase==='error'?<AlertCircle size={17}/>:<Unplug size={17}/>} {labels[phase]}</p>
      <p className="machine-connection-note">{phase==='closed'?'重新连接这台机器后继续。':phase==='error'?'可以重试，或查看详细原因。':phase==='installing'?'安装进度将在这里更新。':'连接完成后自动进入桌面。'}</p>
      {(error||details)&&<details><summary>{phase==='error'?'查看错误详情':'查看执行详情'}</summary><pre>{error||details}</pre></details>}
      {(primary||secondary)&&<div className="machine-connection-actions">{primary&&<button onClick={primary.run}>{primary.label}<ArrowRight size={15}/></button>}{secondary&&<button className="secondary" onClick={secondary.run}>{secondary.label}</button>}</div>}
    </div>
  </section>;
}
