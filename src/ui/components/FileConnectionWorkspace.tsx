import {transferDetail} from '../../shared/transfer-progress';
import {useState} from 'react';
import {ChevronDown,ChevronRight,Files,RefreshCw,ShieldCheck,Unplug,X} from 'lucide-react';
import type {Profile,Transfer} from '../../shared/contracts';
import {FilePanel} from './FilePanel';
import {FtpFilePanel} from './FtpFilePanel';
import './file-connection-workspace.css';

export function FileConnectionWorkspace({sessionId,profile,closed,transfers,onError,onRetry}:{sessionId:string;profile:Profile;closed:boolean;transfers:Transfer[];onError:(error:unknown)=>void;onRetry:()=>void}) {
  const[queueOpen,setQueueOpen]=useState(true),[error,setError]=useState('');
  const ownTransfers=transfers.filter(item=>item.sessionId===sessionId),running=ownTransfers.filter(item=>item.state==='running').length;
  const ftp=profile.protocol==='ftp'||profile.protocol==='ftps';
  return <section className="file-connection-workspace" aria-label={`${profile.name} 文件工作区`}>
    <header className="file-connection-heading"><Files size={20}/><div><h2>{profile.name||profile.host}</h2><span>{profile.host}:{profile.port}</span></div><span className="file-protocol">{profile.protocol==='ftps'&&<ShieldCheck size={13}/>} {profile.protocol?.toUpperCase()||'SFTP'}</span></header>
    {closed&&<div className="file-connection-offline" role="status"><Unplug size={17}/><div><strong>连接已断开</strong><span>保留此页与编辑草稿，重连会打开新的文件会话。</span></div><button onClick={onRetry}><RefreshCw size={14}/>重新连接</button></div>}
    <div className="file-connection-content" inert={closed} aria-disabled={closed}>{ftp?<FtpFilePanel sessionId={sessionId} closed={closed} transfers={ownTransfers}/>:<FilePanel sessionId={sessionId} closed={closed} disableEnvironment transfers={ownTransfers} onError={onError}/>}</div>
    <section className="file-transfer-queue" aria-label="文件传输队列"><button className="file-queue-toggle" aria-expanded={queueOpen} onClick={()=>setQueueOpen(value=>!value)}>{queueOpen?<ChevronDown size={14}/>:<ChevronRight size={14}/>}传输队列<span>{running?`${running} 个进行中`:ownTransfers.length?`${ownTransfers.length} 项`:'暂无任务'}</span></button>
      {error&&<p role="alert">{error}</p>}
      {queueOpen&&ownTransfers.length>0&&<div className="file-queue-items">{ownTransfers.slice(-50).reverse().map(item=><div className="file-transfer-item" key={item.id}>
        <div><span title={item.name}>{item.direction==='upload'?'↑':item.direction==='download'?'↓':'↔'} {item.name}</span><small>{({running:'传输中',done:'已完成',cancelled:'已取消',failed:'失败'} as const)[item.state]}</small>{item.state==='running'&&<button className="icon" title="取消传输" aria-label={`取消传输 ${item.name}`} disabled={closed} onClick={()=>void window.cshell.cancelTransfer(item.id).catch(reason=>setError(reason instanceof Error?reason.message:String(reason)))}><X size={14}/></button>}</div>
        <progress aria-label={`${item.name} 传输进度`} max={Math.max(item.total,1)} value={item.state==='done'?Math.max(item.total,1):item.totalKnown?Math.min(item.done,item.total*.99):undefined}/><small>{transferDetail(item)}</small>{item.error&&<p role="alert">{item.error}</p>}
      </div>)}</div>}
    </section>
  </section>;
}
