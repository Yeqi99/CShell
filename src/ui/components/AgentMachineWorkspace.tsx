import {AgentMachineFiles} from './AgentMachineFiles';
import {AgentMachineAssistant} from './AgentMachineAssistant';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {AgentCall,AgentShellOption,AgentTarget} from '../../shared/agent';
import type {ClientDevice,ClientShell} from '../../shared/client';
import type {Preferences} from '../../shared/contracts';
import {TerminalPane} from './TerminalPane';
import {AgentDesktopView} from './AgentDesktopView';
import {AgentApplications} from './AgentApplications';
import {AgentConfiguration} from './AgentWorkbench';
import {terminalClosed} from '../terminalBus';
import './agent-machine.css';
export function AgentMachineWorkspace({device,target,preferences,active,onSessionCount,onDisconnect}:{onDisconnect:()=>Promise<void>;onSessionCount:(count:number)=>void;device:ClientDevice;target:AgentTarget;preferences:Preferences;active:boolean}){
 const [section,setSection]=useState('terminal'),[visited,setVisited]=useState(['terminal']),[shells,setShells]=useState<AgentShellOption[]>([]),[sessions,setSessions]=useState<{id:string;name:string}[]>([]),[selected,setSelected]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[desktop,setDesktop]=useState<any>();
 useEffect(()=>{onSessionCount(sessions.filter(s=>!terminalClosed(s.id)).length);},[sessions,preferences,active]);
 useEffect(()=>window.cshell.events(event=>{if(event.type==='closed')setSessions(v=>v.some(s=>s.id===event.sessionId)?[...v]:v);}),[]);
 const [pendingFiles,setPendingFiles]=useState<globalThis.File[]>([]);
 const running=useRef<string[]>([]),mounted=useRef(true);
 const call=useCallback((method:AgentCall['method'],params?:unknown)=>window.cshell.agentCall(target.id,{method,params}),[target.id]);
 useEffect(()=>{mounted.current=true;let alive=true;window.cshell.clientShells(device.deviceId).then(s=>{if(alive)setShells(s)}).catch(e=>{if(alive)setError(String(e))});return()=>{alive=false;mounted.current=false;for(const id of running.current)void window.cshell.disconnect(id).catch(()=>{});};},[device.deviceId]);
 const choose=async(next:string)=>{setSection(next);setVisited(v=>v.includes(next)?v:[...v,next]);setError('');if(next==='terminal')try{setShells(await window.cshell.clientShells(device.deviceId));}catch(e){setError(String(e));}if(next==='desktop')try{const [status,packages]=await Promise.all([call('desktop.status'),call('packages.list')]);setDesktop({...status as object,package:(packages as any[]).find(p=>p.id==='cagent.desktop')});}catch(e){setError(String(e));}};
 const open=async(s:AgentShellOption)=>{setBusy(true);setError('');try{const result=await window.cshell.clientConnect(device.deviceId,s.shell as ClientShell,s.distribution);if(!mounted.current){await window.cshell.disconnect(result.sessionId);return;}running.current.push(result.sessionId);setSessions(v=>[...v,{id:result.sessionId,name:s.label}]);setSelected(result.sessionId);}catch(e){setError(String(e));}finally{setBusy(false);}};
 const close=async(id:string)=>{await window.cshell.disconnect(id);running.current=running.current.filter(x=>x!==id);setSessions(v=>v.filter(s=>s.id!==id));if(selected===id)setSelected(running.current.at(-1)??'');};
 return <section className="agent-machine" aria-label={'CAgent 机器 '+target.name} onDragOver={e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();e.dataTransfer.dropEffect='copy';}}} onDrop={e=>{if(!e.dataTransfer.files.length)return;e.preventDefault();if(Array.from(e.dataTransfer.items).some(i=>i.webkitGetAsEntry?.()?.isDirectory)){setError('暂不支持整个文件夹，请先打包后拖入');return;}if(e.dataTransfer.files.length>100){setError('每次最多传输 100 个文件');return;}setPendingFiles(Array.from(e.dataTransfer.files));void choose('files');}}>
  <header><strong>{target.name}</strong><span>{device.host}:{device.port}</span><nav aria-label="机器功能">{[['terminal','终端'],['files','文件'],['desktop','远程桌面'],['applications','应用市场'],['assistant','智能体'],['settings','设置与权限']].map(([id,label])=><button key={id} aria-pressed={section===id} onClick={()=>void choose(id)}>{label}</button>)}</nav><button className="machine-disconnect" onClick={()=>void onDisconnect().catch(e=>setError(String(e)))}>断开连接</button></header>
  {error&&<p role="alert" className="form-error">{error}</p>}
  <div className="machine-terminal" hidden={section!=='terminal'}>
   <div className="machine-terminal-bar"><button title="刷新终端列表" aria-label="刷新终端列表" onClick={()=>void window.cshell.clientShells(device.deviceId).then(setShells).catch(e=>setError(String(e)))}>刷新</button>{shells.map(s=><button key={s.shell+(s.distribution??'')} disabled={busy} onClick={()=>void open(s)}>＋ {s.label}</button>)}{busy&&<span role="status">正在打开终端…</span>}{!shells.length&&<span>未发现已授权的终端</span>}</div>
   <div className="machine-terminal-tabs">{sessions.map(s=><div key={s.id}><button aria-pressed={selected===s.id} onClick={()=>setSelected(s.id)}>{s.name}</button><button aria-label={'关闭 '+s.name} title={'关闭 '+s.name} onClick={()=>void close(s.id).catch(e=>setError(String(e)))}>×</button></div>)}</div>
   {selected&&terminalClosed(selected)&&<p role="status">此终端已断开，可在上方重新打开终端。</p>}<div className="machine-terminal-body">{!sessions.length&&<p>选择上方终端开始，或打开这台机器的远程桌面与应用。</p>}{sessions.map(s=><TerminalPane key={s.id} id={s.id} active={active&&section==='terminal'&&selected===s.id} preferences={preferences} closed={terminalClosed(s.id)} suggestionsEnabled={false} plugins={[]} searching={false} onSearchClose={()=>{}} onError={e=>setError(String(e))}/>)}</div>
  </div>
  <div className="machine-panel" hidden={section!=='files'}>{visited.includes('files')&&<AgentMachineFiles call={call} target={target.id} pendingFiles={pendingFiles} onFilesConsumed={()=>setPendingFiles([])}/>}</div>
  <div className="machine-panel" hidden={section!=='desktop'}>{visited.includes('desktop')&&desktop&&<><button onClick={()=>void choose('desktop')}>刷新桌面状态</button>{!desktop.viewAllowed&&<div className="machine-desktop-notice"><p>{!desktop.package?'这台机器尚未安装远程桌面':!desktop.packageReady?'远程桌面已安装，但尚未就绪':!desktop.enabled?'远程桌面服务未启用':'当前控制端没有观看桌面的权限'}</p>{desktop.package?.reason&&<p>{desktop.package.reason}</p>}<button onClick={()=>void choose('applications')}>管理这台机器的远程桌面</button></div>}<AgentDesktopView onFiles={()=>void choose('files')} target={target.id} canView={desktop.viewAllowed} canControl={desktop.controlAllowed}/></>}</div>
  <div className="machine-panel" hidden={section!=='applications'}>{visited.includes('applications')&&<AgentApplications target={target} call={call}/>}</div>
  <div className="machine-panel" hidden={section!=='assistant'}>{visited.includes('assistant')&&<AgentMachineAssistant call={call}/>}</div>
  <div className="machine-panel agent-workbench" hidden={section!=='settings'}>{visited.includes('settings')&&<AgentConfiguration target={target} machine/>}</div>
 </section>;
}
