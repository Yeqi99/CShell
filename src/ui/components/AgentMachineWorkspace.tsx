import {MachineConnectionState} from './MachineConnectionState';
import {Monitor, Bot, ShieldCheck} from 'lucide-react';
import {MachineRemoteControl} from './MachineRemoteControl';
import {LinuxDesktop} from './LinuxDesktop';
import {LinuxBrowserView} from './LinuxBrowserView';
import './linux-workspace.css';
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
export function AgentMachineWorkspace({device,target,preferences,active,onSessionCount,onDisconnect}:{onDisconnect:()=>Promise<void>;onSessionCount:(count:number,ids:string[])=>void;device:ClientDevice;target:AgentTarget;preferences:Preferences;active:boolean}){
 const [attempt,setAttempt]=useState(0);
 const [machine,setMachine]=useState<any>(),[section,setSection]=useState('loading'),[visited,setVisited]=useState<string[]>([]),[shells,setShells]=useState<AgentShellOption[]>([]),[sessions,setSessions]=useState<{id:string;name:string}[]>([]),[selected,setSelected]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[desktop,setDesktop]=useState<any>();
 useEffect(()=>{const ids=sessions.filter(s=>!terminalClosed(s.id)).map(s=>s.id);onSessionCount(ids.length,ids);},[sessions,preferences,active]);
 useEffect(()=>window.cshell.events(event=>{if(event.type==='closed')setSessions(v=>v.some(s=>s.id===event.sessionId)?[...v]:v);}),[]);
 const android=machine?.platform==='android';
 const linux=machine?.platform==='linux';
 const [pendingFiles,setPendingFiles]=useState<globalThis.File[]>([]);
 const running=useRef<string[]>([]),mounted=useRef(true);
 const call=useCallback((method:AgentCall['method'],params?:unknown)=>window.cshell.agentCall(target.id,{method,params}),[target.id]);
 useEffect(()=>{mounted.current=true;let alive=true;setMachine(undefined);setSection('loading');setVisited([]);setError('');
  void (async()=>{try{
    let status:any;
    try{status=await call('client.status');}catch(statusError){
      // Older or terminal-only grants need not expose management status.
      // Only show the independently authorized shell capability in this case.
      const choices=await window.cshell.clientShells(device.deviceId);
      if(!alive)return;
      if(!choices.length)throw statusError;
      setMachine({terminalOnly:true});setShells(choices);setSection('terminal');setVisited(['terminal']);return;
    }
    if(!alive)return;setMachine(status);
    if(status.platform==='android'){const [screen,packages]=await Promise.all([call('desktop.status'),call('packages.list')]);if(!alive)return;setDesktop({...screen as object,package:(packages as any[]).find(p=>p.id==='cagent.desktop')});setSection('desktop');setVisited(['desktop']);}
    else{const choices=await window.cshell.clientShells(device.deviceId);if(!alive)return;setShells(choices);if(status.platform==='linux'){const browser=await call('visual.status').catch(()=>({supported:false}));if(!alive)return;setMachine({...status,browserSupported:(browser as any).supported});setSection('home');setVisited(['home']);}else{setSection('terminal');setVisited(['terminal']);}}
  }catch(e){if(alive){setSection('status');setError(String(e));}}})();
  return()=>{alive=false;mounted.current=false;for(const id of running.current)void window.cshell.disconnect(id).catch(()=>{});};},[device.deviceId,call,attempt]);
 const choose=async(next:string)=>{if(android&&!['desktop','status'].includes(next)||machine?.terminalOnly&&next!=='terminal')return;setSection(next);setVisited(v=>v.includes(next)?v:[...v,next]);setError('');if(next==='status')try{setMachine(await call('client.status'));if(android){const screen=await call('desktop.status');setDesktop((current:any)=>({...current,...screen as object}));}}catch(e){setError(String(e));}if(next==='terminal')try{setShells(await window.cshell.clientShells(device.deviceId));}catch(e){setError(String(e));}if(next==='desktop')try{const [status,packages]=await Promise.all([call('desktop.status'),call('packages.list')]);setDesktop({...status as object,package:(packages as any[]).find(p=>p.id==='cagent.desktop')});}catch(e){setError(String(e));}};
 const open=async(s:AgentShellOption)=>{setBusy(true);setError('');try{const result=await window.cshell.clientConnect(device.deviceId,s.shell as ClientShell,s.distribution);if(!mounted.current){await window.cshell.disconnect(result.sessionId);return;}running.current.push(result.sessionId);setSessions(v=>[...v,{id:result.sessionId,name:s.label}]);setSelected(result.sessionId);}catch(e){setError(String(e));}finally{setBusy(false);}};
 const close=async(id:string)=>{await window.cshell.disconnect(id);running.current=running.current.filter(x=>x!==id);setSessions(v=>v.filter(s=>s.id!==id));if(selected===id)setSelected(running.current.at(-1)??'');};
 if(machine) return <LinuxDesktop name={target.name} machine={machine} target={target.id} call={call} active={active} terminal={(visible,desktopTheme)=>(<div className="machine-terminal">
   <div className="machine-terminal-bar"><button title="刷新终端列表" aria-label="刷新终端列表" onClick={()=>void window.cshell.clientShells(device.deviceId).then(setShells).catch(e=>setError(String(e)))}>刷新</button>{shells.map(s=><button key={s.shell+(s.distribution??'')} disabled={busy} onClick={()=>void open(s)}>＋ {s.label}</button>)}{busy&&<span role="status">正在打开终端…</span>}{!shells.length&&<span>未发现已授权的终端</span>}</div>
   <div className="machine-terminal-tabs">{sessions.map(s=><div key={s.id}><button aria-pressed={selected===s.id} onClick={()=>setSelected(s.id)}>{s.name}</button><button aria-label={'关闭 '+s.name} title={'关闭 '+s.name} onClick={()=>void close(s.id).catch(e=>setError(String(e)))}>×</button></div>)}</div>
   {selected&&terminalClosed(selected)&&<p role="status">此终端已断开，可在上方重新打开终端。</p>}<div className="machine-terminal-body">{!sessions.length&&<p>选择上方终端开始，或打开这台机器的远程桌面与应用。</p>}{sessions.map(s=><TerminalPane key={s.id} id={s.id} active={visible&&selected===s.id} preferences={{...preferences,theme:desktopTheme}} closed={terminalClosed(s.id)} suggestionsEnabled={false} plugins={[]} searching={false} onSearchClose={()=>{}} onError={e=>setError(String(e))}/>)}</div>
  </div>)} extraPanels={[...(!machine.terminalOnly && (machine.platform==='win32'||android) ? [{id:'remote',label:'远程控制',icon:Monitor,content:(visible:boolean,options:boolean,closeOptions:()=>void)=><MachineRemoteControl target={target.id} call={call} active={visible} android={android} optionsOpen={options} onCloseOptions={closeOptions}/>}]:[]),...(!machine.terminalOnly&&!android ? [{id:'assistant',label:'智能体',icon:Bot,content:<AgentMachineAssistant call={call} name={target.name}/>},{id:'permissions',label:'设置与权限',icon:ShieldCheck,content:<div className="agent-workbench"><AgentConfiguration target={target} machine/><button onClick={()=>void onDisconnect().catch(e=>setError(String(e)))}>断开连接</button>{error&&<p role="alert">{error}</p>}</div>}]:[])]} />;
 if(!machine) return <MachineConnectionState name={target.name} phase={section==='loading'?'connecting':'error'} error={error} primary={section!=='loading'?{label:'重试连接',run:()=>setAttempt(v=>v+1)}:undefined} secondary={{label:'关闭连接',run:()=>void onDisconnect().catch(e=>setError(String(e)))}}/>;
 return <section className="agent-machine" aria-label={'CAgent 机器 '+target.name} onDragOver={e=>{if(!machine||android||machine.terminalOnly)return;if(e.dataTransfer.types.includes('Files')){e.preventDefault();e.dataTransfer.dropEffect='copy';}}} onDrop={e=>{if(!machine||android||machine.terminalOnly){if(e.dataTransfer.files.length)e.preventDefault();return;}if(!e.dataTransfer.files.length)return;e.preventDefault();if(Array.from(e.dataTransfer.items).some(i=>i.webkitGetAsEntry?.()?.isDirectory)){setError('暂不支持整个文件夹，请先打包后拖入');return;}if(e.dataTransfer.files.length>100){setError('每次最多传输 100 个文件');return;}setPendingFiles(Array.from(e.dataTransfer.files));void choose('files');}}>
  <header><strong>{target.name}</strong><span>{device.host}:{device.port}</span><nav aria-label="机器功能">{(android?[['desktop','远程桌面'],['status','设备状态']]:machine?.terminalOnly?[['terminal','终端']]:machine?[...(linux?[['home','工作区']]:[]),['terminal','终端'],['files','文件'],...(linux?(machine.browserSupported?[['browser','浏览器']]:[]):[['desktop','远程桌面']]),['applications','应用市场'],['assistant','智能体'],['settings','设置与权限']]:[]).map(([id,label])=><button key={id} aria-pressed={section===id} onClick={()=>void choose(id)}>{label}</button>)}</nav><button className="machine-disconnect" onClick={()=>void onDisconnect().catch(e=>setError(String(e)))}>断开连接</button></header>
  {section==='loading'&&<p className="machine-panel" role="status">正在读取设备能力…</p>}
  {section==='status'&&<div className="machine-panel machine-device-status"><h3>设备状态</h3><button onClick={()=>void choose('status')}>刷新状态</button>{machine&&<dl><dt>系统</dt><dd>{machine.platform==='android'?'Android':machine.platform}</dd><dt>远程连接</dt><dd>{machine.running?'已开启':'已停止'}</dd>{android&&<><dt>屏幕共享</dt><dd>{desktop?.viewAllowed?'正在共享':'未共享，请在手机上开始共享并确认系统授权'}</dd><dt>触摸与键盘控制</dt><dd>{desktop?.controlAllowed?'已开启':'未开启，请在手机系统设置中启用 CAgent 辅助控制'}</dd></>}<dt>设备身份</dt><dd>{machine.deviceId||device.deviceId}</dd></dl>}</div>}
  {error&&<p role="alert" className="form-error">{error}</p>}
  {section==='home'&&<div className="linux-home"><span className="linux-eyebrow">YOUR REMOTE SPACE</span><h1>在 {target.name} 上工作</h1><p>应用在 Linux 运行，终端与文件保持在同一台机器。</p><div className="linux-apps">{[['terminal','终端','打开原生 Linux 终端'],['files','文件','浏览与传输文件'],...(machine?.browserSupported?[['browser','浏览器','使用服务器网络访问网页']]:[]),['applications','应用市场','安装系统与可视化应用']].map(([id,label,note])=><button className="linux-app" key={id} onClick={()=>void choose(id)}><strong>{label}</strong><small>{note}</small></button>)}</div></div>}
  <div className="machine-panel" hidden={section!=='browser'}>{visited.includes('browser')&&<LinuxBrowserView call={call} active={active&&section==='browser'} onMarket={()=>void choose('applications')}/>}</div>
  <div className="machine-terminal" hidden={section!=='terminal'}>
   <div className="machine-terminal-bar"><button title="刷新终端列表" aria-label="刷新终端列表" onClick={()=>void window.cshell.clientShells(device.deviceId).then(setShells).catch(e=>setError(String(e)))}>刷新</button>{shells.map(s=><button key={s.shell+(s.distribution??'')} disabled={busy} onClick={()=>void open(s)}>＋ {s.label}</button>)}{busy&&<span role="status">正在打开终端…</span>}{!shells.length&&<span>未发现已授权的终端</span>}</div>
   <div className="machine-terminal-tabs">{sessions.map(s=><div key={s.id}><button aria-pressed={selected===s.id} onClick={()=>setSelected(s.id)}>{s.name}</button><button aria-label={'关闭 '+s.name} title={'关闭 '+s.name} onClick={()=>void close(s.id).catch(e=>setError(String(e)))}>×</button></div>)}</div>
   {selected&&terminalClosed(selected)&&<p role="status">此终端已断开，可在上方重新打开终端。</p>}<div className="machine-terminal-body">{!sessions.length&&<p>选择上方终端开始，或打开这台机器的远程桌面与应用。</p>}{sessions.map(s=><TerminalPane key={s.id} id={s.id} active={active&&section==='terminal'&&selected===s.id} preferences={preferences} closed={terminalClosed(s.id)} suggestionsEnabled={false} plugins={[]} searching={false} onSearchClose={()=>{}} onError={e=>setError(String(e))}/>)}</div>
  </div>
  <div className="machine-panel" hidden={section!=='files'}>{visited.includes('files')&&<AgentMachineFiles call={call} target={target.id} pendingFiles={pendingFiles} onFilesConsumed={()=>setPendingFiles([])}/>}</div>
  <div className="machine-panel" hidden={section!=='desktop'}>{visited.includes('desktop')&&desktop&&<><button onClick={()=>void choose('desktop')}>刷新桌面状态</button>{!desktop.viewAllowed&&<div className="machine-desktop-notice"><p>{android?'请在手机 CShell 的 CAgent 扩展中开始共享，并确认 Android 系统授权。':!desktop.package?'这台机器尚未安装远程桌面':!desktop.packageReady?'远程桌面已安装，但尚未就绪':!desktop.enabled?'远程桌面服务未启用':'当前控制端没有观看桌面的权限'}</p>{desktop.package?.reason&&<p>{desktop.package.reason}</p>}{!android&&<button onClick={()=>void choose('applications')}>管理这台机器的远程桌面</button>}</div>}<AgentDesktopView onFiles={android?undefined:()=>void choose('files')} target={target.id} canView={desktop.viewAllowed} canControl={desktop.controlAllowed}/></>}</div>
  <div className="machine-panel" hidden={section!=='applications'}>{visited.includes('applications')&&<AgentApplications target={target} call={call}/>}</div>
  <div className="machine-panel" hidden={section!=='assistant'}>{visited.includes('assistant')&&<AgentMachineAssistant call={call} name={target.name}/>}</div>
  <div className="machine-panel agent-workbench" hidden={section!=='settings'}>{visited.includes('settings')&&<AgentConfiguration target={target} machine/>}</div>
 </section>;
}
