import {useEffect,useRef,useState} from 'react';
import RFB from '@novnc/novnc';
import './native-desktop.css';

class DesktopChannel {
  binaryType='arraybuffer'; protocol=''; readyState=0;
  onmessage:((event:{data:ArrayBuffer})=>void)|null=null;
  onopen:(()=>void)|null=null;
  onerror:(()=>void)|null=null;
  onclose:((event:{code:number;reason:string;wasClean:boolean})=>void)|null=null;
  private pending=Promise.resolve(); private queued=0;
  constructor(private id:string){}
  async start(){
    this.readyState=1;this.onopen?.();
    try{while(this.readyState===1){const bytes=await window.cshell.nativeDesktopRead(this.id);if(this.readyState!==1)return;if(bytes===null){this.close();return;}if(bytes.length)this.onmessage?.({data:new Uint8Array(bytes).buffer});}}
    catch{this.onerror?.();this.close();}
  }
  send(data:Uint8Array){
    if(this.readyState!==1)return;
    const copy=new Uint8Array(data);this.queued+=copy.length;
    if(this.queued>2*1024*1024){this.onerror?.();this.close();return;}
    this.pending=this.pending.then(async()=>{if(this.readyState===1)await window.cshell.nativeDesktopWrite(this.id,copy);}).catch(()=>{this.onerror?.();this.close();}).finally(()=>{this.queued-=copy.length;});
  }
  close(){if(this.readyState===3)return;this.readyState=3;void window.cshell.nativeDesktopClose(this.id).catch(()=>{});this.onclose?.({code:1000,reason:'桌面连接已关闭',wasClean:true});}
}

export function NativeDesktop({session,closed,active,initialInfo}:{session:string;closed:boolean;active:boolean;initialInfo?:Awaited<ReturnType<typeof window.cshell.nativeDesktopSetup>>}){
  const host=useRef<HTMLDivElement>(null),rfb=useRef<RFB|null>(null),channel=useRef<DesktopChannel|null>(null),generation=useRef(0);
  const [port,setPort]=useState('5901'),[socket,setSocket]=useState(''),[password,setPassword]=useState('');
  const [status,setStatus]=useState('idle'),[error,setError]=useState(''),[needsPassword,setNeedsPassword]=useState(false);
  const [detected,setDetected]=useState(initialInfo),[checking,setChecking]=useState(false);
  const inspect=async()=>{if(closed)return;setChecking(true);try{setDetected(await window.cshell.nativeDesktopSetup(session,'inspect'));}catch{setError('桌面检测失败，请确认连接正常且服务器有 Python 3。');}finally{setChecking(false);}};
  useEffect(()=>{void inspect();},[session,closed]);
  const stop=()=>{generation.current++;rfb.current?.disconnect();rfb.current=null;channel.current?.close();channel.current=null;};
  useEffect(()=>()=>stop(),[session]);
  useEffect(()=>{if(closed){stop();setStatus('idle');setError('SSH 已断开，重新连接机器后可打开原生桌面。');}},[closed]);
  useEffect(()=>{if(rfb.current)rfb.current.viewOnly=!active;},[active]);
  const connect=async(endpoint?:{socket:string}|{port:number})=>{
    stop();const current=generation.current;setError('');setStatus('connecting');setNeedsPassword(false);
    try{
      const id=await window.cshell.nativeDesktopOpen(session,endpoint || (socket.trim()?{socket:socket.trim()}:{port:Number(port)}));
      if(current!==generation.current){await window.cshell.nativeDesktopClose(id);return;}
      const transport=new DesktopChannel(id);channel.current=transport;
      const client=new RFB(host.current!,transport,{credentials:{password}});rfb.current=client;setPassword('');
      client.scaleViewport=true;client.resizeSession=false;client.viewOnly=!active;
      client.addEventListener('connect',()=>{if(current===generation.current){setStatus('connected');setNeedsPassword(false);}});
      client.addEventListener('credentialsrequired',()=>{if(current===generation.current)setNeedsPassword(true);});
      client.addEventListener('securityfailure',()=>{if(current===generation.current)setError('桌面认证失败，请检查 VNC 密码。');});
      client.addEventListener('disconnect',()=>{if(current===generation.current){setStatus('idle');setError('原生桌面已断开，可检查服务后重试。');}});
      // noVNC attaches its channel handlers in a scheduled constructor callback.
      setTimeout(()=>{if(current===generation.current)void transport.start();else transport.close();},0);
    }catch{if(current===generation.current){stop();setStatus('idle');setError('无法连接桌面服务。请确认这台机器已开启 VNC，并填写正确的端口或套接字。');}}
  };
  const enable=async()=>{setChecking(true);setError('');try{const result=await window.cshell.nativeDesktopSetup(session,detected?.installed?'start':'install-start');setDetected({...detected,...result,installed:true});await connect({socket:result.socket});}catch(e){setError(String(e));}finally{setChecking(false);}};
  return <section className="native-desktop-app" aria-label="原生 Linux 桌面">
    <header><strong>原生桌面</strong><span>{status==='connected'?'已连接 · SSH 加密通道':status==='connecting'?'正在连接…':'VNC · 通过当前 SSH 连接'}</span>{status!=='idle'&&<button onClick={()=>{stop();setStatus('idle');setNeedsPassword(false);}}>断开</button>}</header>
    {error&&<p role="alert">{error}</p>}
    {status==='idle'&&<div className="native-desktop-setup"><h3>打开服务器上的桌面</h3><p role="status">{checking?'正在检查或配置桌面…':detected?.message || '等待检测桌面环境'}</p>
      {detected?.sessions?.length===1&&<><p>共享当前用户的 {detected.sessions[0].display} 屏幕，鼠标与键盘操作会作用于真实桌面。{!detected.installed?'将从系统软件源下载 x11vnc 组件至用户专用目录，不修改系统安装。':''}</p><button disabled={closed||checking||(!detected.installed&&!detected.canInstall)} onClick={()=>void enable()}>{detected.running?'连接原生桌面':detected.installed?'开启并连接':'安装组件并开启'}</button></>}
      {detected?.running&&<button disabled={checking} onClick={()=>{stop();setChecking(true);void window.cshell.nativeDesktopSetup(session,'stop').then(()=>inspect()).catch(()=>setError('停止共享失败，请检查连接')).finally(()=>setChecking(false));}}>停止共享</button>}
      <button disabled={closed||checking} onClick={()=>void inspect()}>重新检测</button>
      <details><summary>连接已有 VNC 服务</summary><label>VNC 端口<input type="number" min="5900" max="5999" value={port} onChange={e=>setPort(e.target.value)} /></label><label>VNC 密码<input type="password" autoComplete="off" value={password} onChange={e=>setPassword(e.target.value)}/></label><label>Unix 套接字<input value={socket} onChange={e=>setSocket(e.target.value)} placeholder="留空时使用端口"/></label><button disabled={closed||checking} onClick={()=>void connect()}>连接已有桌面</button></details><small>通过 SSH 加密连接，不开放公网端口。当前支持 X11 屏幕和已有 VNC 服务；Wayland / RDP 需要兼容的共享服务。断开观看保留共享，停止共享不会注销桌面。</small></div>}
    {needsPassword&&<form onSubmit={e=>{e.preventDefault();rfb.current?.sendCredentials({password});setPassword('');setNeedsPassword(false);}}><label>桌面密码<input type="password" value={password} onChange={e=>setPassword(e.target.value)}/></label><button>连接</button></form>}
    <div className="native-desktop-screen" ref={host} hidden={status==='idle'}/>
  </section>;
}

