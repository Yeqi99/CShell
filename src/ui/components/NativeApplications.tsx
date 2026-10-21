import {useEffect, useState} from 'react';
import {ArrowLeft, AppWindow, RefreshCw, Folder, X} from 'lucide-react';
import type {AgentCall} from '../../shared/agent';
import {LinuxBrowserView} from './LinuxBrowserView';

export function NativeApplications({call,active,onMarket,onMinimize,optionsOpen,onCloseOptions,storageKey}:{call:(method:AgentCall['method'],params?:unknown)=>Promise<unknown>;active:boolean;onMarket:()=>void;onMinimize?:()=>void;optionsOpen:boolean;onCloseOptions:()=>void;storageKey:string}) {
  const [status,setStatus]=useState<any>(),[selected,setSelected]=useState(()=>{try{return localStorage.getItem(storageKey)==='true';}catch{return false;}}),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{try{localStorage.setItem(storageKey,String(selected));}catch{}},[storageKey,selected]);
  const refresh=async()=>{setError('');try{setStatus(await call('visual.status'));}catch(e){setError(String(e));}};
  useEffect(()=>{void refresh();},[call]);
  return <div className="native-app-folder" data-options={optionsOpen}>
    <header>{optionsOpen&&<button title="关闭应用设置" aria-label="关闭应用设置" onClick={onCloseOptions}><X size={16}/></button>}<button title={selected?'返回应用':'刷新应用'} aria-label={selected?'返回应用':'刷新应用'} onClick={()=>selected?setSelected(false):void refresh()}>{selected?<ArrowLeft size={16}/>:<RefreshCw size={16}/>}</button><strong>{selected?'Chrome · 远端':'已安装的应用'}</strong>{!selected&&<button onClick={onMarket}>应用市场</button>}</header>
    {error&&<p role="alert">{error}</p>}
    {selected?<LinuxBrowserView call={call} active={active} onMarket={onMarket} onMinimize={onMinimize}/>:<div className="native-app-grid">
      {status?.applications?.filter((app:any)=>app.available&&app.id==='browser').map((app:any)=><button key={app.id} disabled={busy} onClick={()=>{setBusy(true);setError('');void call('visual.launch',{app:app.id}).then(()=>setSelected(true)).catch(e=>setError(String(e))).finally(()=>setBusy(false));}}><AppWindow size={32}/><strong>Chrome</strong><small>{app.running?'正在运行':'远端应用'}</small></button>)}
      {!status&&!error&&<p role="status">正在读取应用…</p>}
      {status&&!status.applications?.some((app:any)=>app.available&&app.id==='browser')&&<div className="linux-empty"><Folder size={36}/><h2>还没有可启动的应用</h2><p>从应用市场安装并完成配置后，应用会显示在这里。</p></div>}
    </div>}
  </div>;
}
