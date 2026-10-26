import {useEffect,useRef,useState} from 'react';
import {Monitor,Radio,RefreshCw,Square,Eye,Play} from 'lucide-react';
import type {ClassroomBridge,ClassroomScreen,ClassroomSource,ClassroomStatus} from '../../shared/classroom';
import './classroom.css';

export function ClassroomView({bridge,onWatch}:{bridge:ClassroomBridge;onWatch:(source:ClassroomSource)=>void}) {
  const [role,setRole]=useState<'watch'|'share'>('watch');
  const [status,setStatus]=useState<ClassroomStatus|null>(null),[screens,setScreens]=useState<ClassroomScreen[]>([]);
  const [screenId,setScreenId]=useState(''),[label,setLabel]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const alive=useRef(false),running=useRef(false);
  useEffect(()=>{
    alive.current=true;let cancelled=false,timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{try{const next=await bridge.status();if(!cancelled&&!running.current)setStatus(next);}catch(e){if(!cancelled)setError(String(e));}finally{if(!cancelled)timer=setTimeout(poll,2000);}};
    void poll();
    void bridge.screens().then(items=>{if(!cancelled){setScreens(items);setScreenId(current=>items.some(s=>s.id===current)?current:items[0]?.id||'');}}).catch(e=>{if(!cancelled)setError(String(e));});
    return()=>{cancelled=true;alive.current=false;clearTimeout(timer);};
  },[bridge]);
  const run=async(action:()=>Promise<ClassroomStatus>)=>{
    if(running.current)return;running.current=true;setBusy(true);setError('');
    try{const next=await action();if(alive.current)setStatus(next);}catch(e){if(alive.current)setError(String(e));}
    finally{running.current=false;if(alive.current)setBusy(false);}
  };
  return <section className="classroom" aria-label="机房屏幕共享">
    {status?.sharing&&<div className="classroom-live" role="status"><Radio size={19}/><div><strong>正在共享 · {status.sharing.label}</strong><span>同一局域网内启用此扩展的设备可以观看</span></div><button onClick={()=>void run(()=>bridge.stop())} disabled={busy}><Square size={15}/>停止共享</button></div>}
    <div className="classroom-switch" aria-label="共享方式"><button aria-pressed={role==='watch'} onClick={()=>setRole('watch')}><Eye size={17}/>观看屏幕</button><button aria-pressed={role==='share'} onClick={()=>setRole('share')}><Monitor size={17}/>共享我的屏幕</button></div>
    {(error||status?.error)&&<div className="classroom-error" role="alert">{error||status?.error}<button onClick={()=>void run(()=>bridge.status())} disabled={busy}>重试</button></div>}
    {!status?<p role="status">正在检查共享服务…</p>:!status.supported?<div className="classroom-empty"><Monitor/><h3>当前平台暂不支持屏幕共享</h3><p>不会自动打开远程控制或请求额外权限。</p></div>:role==='watch'?<>
      <div className="classroom-heading"><div><h2>局域网中的屏幕</h2><p>选择一个共享，在独立标签页中只读观看。</p></div><button disabled={busy} onClick={()=>void run(()=>bridge.setDiscovery(!status.discovering))}>{status.discovering?'停止发现':'查找共享'}</button></div>
      <div className="classroom-discovery" role="status"><span className={status.discovering?'active':''}/>{status.discovering?'正在发现 · 列表自动更新':'发现已停止'}</div>
      {status.sources.length===0?<div className="classroom-empty"><Radio size={32}/><h3>{status.discovering?'还没有发现共享':'开始查找老师的屏幕'}</h3><p>{status.discovering?'确认在同一局域网，且对方已点击“开始共享”。':'只查找共享服务，不连接或控制其他机器。'}</p></div>:<div className="classroom-sources">{status.sources.map(source=><button className="classroom-source" key={source.id} onClick={()=>onWatch(source)}><span className="classroom-source-icon"><Monitor size={24}/></span><span><strong>{source.label}</strong><small>{source.address} · 只读观看</small></span><Play size={18}/></button>)}</div>}
    </>:<form className="classroom-share" onSubmit={event=>{event.preventDefault();void run(()=>bridge.start({screenId,label:label.trim()||'我的屏幕'}));}}>
      <h2>把当前屏幕分享给同学</h2><p>这是局域网只读广播，不是私密加密会议。开始后，同一局域网中的用户可发现并观看整个所选屏幕；请先关闭不希望展示的窗口。</p>
      <label>共享名称<input value={label} maxLength={60} placeholder="例如：老师的演示屏幕" onChange={e=>setLabel(e.target.value)} disabled={busy||!!status.sharing}/></label>
      <label>选择屏幕<select value={screenId} onChange={e=>setScreenId(e.target.value)} disabled={busy||!!status.sharing}><option value="" disabled>选择要共享的屏幕</option>{screens.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      {!screens.length&&<p>没有可用屏幕。请检查系统屏幕录制权限后重新进入扩展。</p>}
      <div className="classroom-share-footer"><p>仅共享画面 · 不传输音频 · 不允许鼠标或键盘控制</p><button className="primary" type="submit" disabled={busy||!screenId||!!status.sharing}><Radio size={17}/>{status.sharing?'正在共享':busy?'正在启动…':'开始共享'}</button></div>
    </form>}
  </section>;
}

export function ClassroomViewer({bridge,source,visible=true}:{bridge:ClassroomBridge;source:ClassroomSource;visible?:boolean}) {
  const [frame,setFrame]=useState(''),[error,setError]=useState(''),[retry,setRetry]=useState(0),[loaded,setLoaded]=useState(false);
  const imageFailed=useRef(false);
  useEffect(()=>{
    let cancelled=false,timer:ReturnType<typeof setTimeout>;
    setFrame('');setError('');setLoaded(false);imageFailed.current=false;
    if(!visible)return;
    const poll=async()=>{if(imageFailed.current)return;try{const next=await bridge.frame(source.id);if(cancelled||imageFailed.current)return;setFrame(next.dataUrl);timer=setTimeout(poll,200);}catch(e){if(!cancelled){setFrame('');setLoaded(false);setError(String(e));}}};
    void poll();return()=>{cancelled=true;clearTimeout(timer);};
  },[bridge,source.id,visible,retry]);
  return <section className="classroom-viewer" aria-label={`${source.label} · 只读观看`}>
    <header><Monitor size={18}/><strong>{source.label}</strong><span><Eye size={14}/>只读 · 无音频</span><button className="icon" aria-label="重新连接共享" title="重新连接共享" onClick={()=>setRetry(n=>n+1)}><RefreshCw size={16}/></button></header>
    <div className="classroom-screen">{error?<div className="classroom-viewer-message" role="alert"><h3>共享画面已断开</h3><p>{error}</p><button onClick={()=>setRetry(n=>n+1)}>重新连接</button></div>:!visible?<p>切回此标签后继续观看</p>:<>{!loaded&&<p role="status">正在连接共享画面…</p>}{frame&&<img src={frame} alt={`${source.label} 的共享画面`} draggable={false} onLoad={()=>setLoaded(true)} onError={()=>{imageFailed.current=true;setFrame('');setLoaded(false);setError('无法显示收到的画面，请重新连接。');}}/>}</>}</div>
  </section>;
}
