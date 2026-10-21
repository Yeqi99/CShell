import {useEffect, useState} from 'react';
import {Monitor, RefreshCw, X} from 'lucide-react';
import type {AgentCall} from '../../shared/agent';
import {AgentDesktopView} from './AgentDesktopView';

export function MachineRemoteControl({target, call, active, android, optionsOpen, onCloseOptions}: {
  target:string; call:(method:AgentCall['method'], params?:unknown)=>Promise<unknown>; active:boolean; android:boolean; optionsOpen:boolean; onCloseOptions:()=>void;
}) {
  const [status,setStatus]=useState<any>();
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const refresh=async()=>{setBusy(true);setError('');try{setStatus(await call('desktop.status'));}catch(e){setError(String(e));}finally{setBusy(false);}};
  useEffect(()=>{void refresh();},[target,call]);
  return <div className="machine-remote-app" data-options={optionsOpen}>
    {optionsOpen&&<button className="machine-options-close" title="关闭应用设置" aria-label="关闭应用设置" onClick={onCloseOptions}><X size={16}/></button>}
    {!status?.viewAllowed&&<div className="machine-remote-status"><Monitor size={16}/><span>{busy?'正在检查远程控制…':status?.viewAllowed?'可以连接':'尚未就绪'}</span><button title="刷新远程控制状态" aria-label="刷新远程控制状态" disabled={busy} onClick={()=>void refresh()}><RefreshCw size={15}/></button></div>}
    {error&&<p role="alert">{error}</p>}
    {status&&!status.viewAllowed&&<div className="linux-empty"><Monitor size={36}/><h2>远程控制尚未就绪</h2><p>{android?'请在手机上开始屏幕共享并确认系统授权。':!status.packageReady?'请在这台机器的应用市场安装并配置远程桌面能力。':!status.enabled?'请在目标机器启用远程桌面服务。':'当前控制端尚未获得观看权限。'}</p></div>}
    {status?.viewAllowed&&<AgentDesktopView target={target} canView={status.viewAllowed} canControl={status.controlAllowed} visible={active} autoConnect={active} embedded optionsOpen={optionsOpen}/>}
  </div>;
}
