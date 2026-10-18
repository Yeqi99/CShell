import {useEffect,useRef,useState} from 'react';
import type {Profile} from '../../shared/contracts';
import type {ClientDevice} from '../../shared/client';
import './client.css';

export function SavedAgentConnection({profile,onConnect,onDone}:{profile:Profile;onConnect:(device:ClientDevice)=>Promise<void>;onDone:()=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[password,setPassword]=useState(''),[reauth,setReauth]=useState(false);
 const started=useRef(false);
 async function connect(auth=false){
  setBusy(true);setError('');
  try{
   let device=(await window.cshell.clientDevices()).find(d=>d.deviceId===profile.id);
   if(!device)throw new Error('已保存的设备身份不可用，请从连接菜单更新认证。');
   if(auth){
    const info=await window.cshell.clientProbe({host:device.host,port:device.port});
    if(info.deviceId!==device.deviceId)throw new Error('远端设备身份已改变，请先核对设备身份。');
    device=await window.cshell.clientPasswordPair(info,password);
    setPassword('');setReauth(false);
   }
   await onConnect(device);onDone();
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 useEffect(()=>{if(!started.current){started.current=true;void connect();}},[]);
 return <section className="client-page saved-agent-connection"><h2>{profile.name}</h2><p>{profile.host}:{profile.port}</p>
  <p>{busy?'正在连接已保存的 cagent…':'使用已保存的设备身份连接'}</p>
  {error&&<p role="alert" className="error">{error}</p>}
  {reauth&&<label>连接密码<input type="password" autoComplete="off" value={password} onChange={e=>setPassword(e.target.value)} disabled={busy}/></label>}
  <div className="form-actions"><button className="primary" disabled={busy||(reauth&&!password)} onClick={()=>void connect(reauth)}>{reauth?'认证并连接':'重试连接'}</button>
  <button disabled={busy} onClick={()=>{setReauth(v=>!v);setPassword('');}}>{reauth?'取消重新认证':'重新认证'}</button></div>
 </section>;
}

