import {useEffect,useRef,useState} from 'react';
import {useDesktopText} from '../desktop-i18n';
import {Monitor} from 'lucide-react';
import type {Profile} from '../../shared/contracts';
import './windows-session-picker.css';

export function WindowsSessionPicker({target,deviceId,active,profiles,open}:{target:string;deviceId:string;active:boolean;profiles:Profile[];open:(p:Profile)=>void}){
  const tr=useDesktopText();
  const storageKey='cshell.windows-login.'+deviceId;
  const [remembered,setRemembered]=useState(()=>localStorage.getItem(storageKey)||'');
  const [selected,setSelected]=useState(remembered);
  const actions=useRef({profiles,open});
  actions.current={profiles,open};
  useEffect(()=>{
    if(!active||!remembered)return;
    let cancelled=false;
    const login=async()=>{
      const profile=actions.current.profiles.find(p=>p.id===remembered);
      if(!profile)return;
      const plan=await window.cshell.agentCall(target,{method:'desktop.recovery.plan'}) as {sourceUnlocked?:boolean;sourceState?:number};
      if(cancelled||(plan.sourceUnlocked!==false&&plan.sourceState!==4))return;
      if(await window.cshell.verifyAgentRdp(target,profile.id)&&!cancelled)actions.current.open(profile);
    };
    void login().catch(()=>{if(!cancelled)setError('自动登录未完成，请核验并打开 Windows 会话。')});
    return()=>{cancelled=true};
  },[target,active,remembered]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [legacy,setLegacy]=useState(false);
  const mounted=useRef(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const connect=async()=>{
    const profile=profiles.find(p=>p.id===selected);
    if(!profile||busy)return;
    setBusy(true);setError('');setLegacy(false);
    try{
      if(await window.cshell.verifyAgentRdp(target,profile.id)&&mounted.current)open(profile);
    }catch(e){
      if(mounted.current){
        const unsupported=/INVALID_PARAMETERS|unknown method|unsupported method|invalid.option|invalid.value|旧版|不支持.*方法/i.test(String(e));
        setLegacy(unsupported);
        setError(unsupported?'远端版本尚未提供证书核验。可单独打开下方地址，按 Windows 提示核对服务器。':/不匹配/.test(String(e))?'RDP 证书与当前机器不匹配，请重新选择。':'无法核对目标证书。请检查 RDP 地址、网络和远端查看权限。');
      }
    }finally{if(mounted.current)setBusy(false);}
  };
  return <details className="windows-session-picker"><summary><Monitor size={15}/>{tr('打开 Windows 会话')}</summary>
    <div><label>{tr('已保存的 RDP 连接')}<select value={selected} disabled={busy} onChange={e=>{setSelected(e.target.value);setError('');setLegacy(false);}}>
      <option value="">{tr('选择连接')}</option>{profiles.map(p=><option key={p.id} value={p.id}>{p.name} · {p.host}:{p.port}</option>)}
    </select></label><button disabled={!selected||busy} onClick={()=>void connect()}>{tr(busy?'正在核对证书…':'核验并打开')}</button></div>
    <label><input type="checkbox" disabled={!selected} checked={!!remembered&&remembered===selected} onChange={e=>{const value=e.target.checked?selected:'';if(value)localStorage.setItem(storageKey,value);else localStorage.removeItem(storageKey);setRemembered(value);}}/>锁屏或会话断开时用此 RDP 连接自动登录</label>
    <small role="status">{tr(error||'通过内置 RDP 标签页登录，可用于没有显示器的 Windows。')}</small>
    {legacy&&profiles.filter(p=>p.id===selected).map(p=><button key={p.id} onClick={()=>open(p)}>{tr('打开连接')} {p.host}:{p.port}</button>)}
  </details>;
}
