import {useState} from 'react';
import {Download,ChevronDown,ArrowUpRight} from 'lucide-react';
import type {AgentDownload} from '../../shared/agent-downloads';
import {useI18n} from '../i18n';
import './agent-downloads.css';
export function AgentDownloadEntry(){
 const cn=useI18n().locale==='zh-CN';
 const[items,setItems]=useState<Omit<AgentDownload,'url'>[]>([]),[selected,setSelected]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[loaded,setLoaded]=useState(false);
 const load=async()=>{setBusy(true);setError('');try{const list=await window.cshell.agentDownloadList();setItems(list);setSelected(list.find(x=>x.id==='win-x64')?.id||list[0]?.id||'');setLoaded(true);}catch{setError(cn?'暂时无法获取安装包，请重试。':'Unable to load packages. Please retry.')}finally{setBusy(false)}};
 const item=items.find(x=>x.id===selected);
 return <details className="agent-download-entry" onToggle={e=>{if(e.currentTarget.open&&!loaded&&!busy)void load()}}>
  <summary><Download size={14}/><span>{cn?'目标机器还没有 CAgent？':'Need CAgent on your machine?'}</span><span className="agent-download-label">{cn?'下载安装':'Get CAgent'}</span><ChevronDown size={13}/></summary>
  <div className="agent-download-content">
   <p>{cn?'选择目标机器的系统。安装后，在 CAgent 中复制连接信息回到这里。':'Choose the target system. Once installed, copy the connection details from CAgent.'}</p>
   {busy?<p role="status">{cn?'正在获取安装包…':'Loading packages…'}</p>:<>
    {items.length>0&&<div className="agent-download-controls"><select aria-label={cn?'CAgent 目标系统':'CAgent target system'} value={selected} onChange={e=>setSelected(e.target.value)}>{items.map(x=><option key={x.id} value={x.id}>{x.platform} · {x.arch.toUpperCase()} · {x.version}</option>)}</select><button type="button" disabled={!item} onClick={()=>{setError('');void window.cshell.agentDownloadOpen(selected).catch(()=>setError(cn?'无法打开下载，请重试。':'Unable to open download.'))}}><Download size={14}/>{cn?'下载':'Download'}<ArrowUpRight size={12}/></button></div>}
    {loaded&&!items.length&&<p>{cn?'暂无匹配的安装包。':'No packages available.'}</p>}
    {item&&<small>{cn?'香港下载源':'Hong Kong download'} · {(item.size/1048576).toFixed(1)} MB{item.platform!=='Windows'&&(cn?' · 实验版':' · Experimental')}</small>}
   </>}
   {error&&<div className="agent-download-error" role="alert">{error}<button type="button" disabled={busy} onClick={()=>void load()}>{cn?'重试':'Retry'}</button></div>}
  </div>
 </details>
}
