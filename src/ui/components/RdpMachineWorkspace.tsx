import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Download, Monitor, Package } from 'lucide-react';
import type { Profile } from '../../shared/contracts';

import './rdp-install-guide.css';

const windowsDownloadPage = 'https://shell.canp.ai/downloads.html?product=cagent&system=windows';

/** Installation is performed inside the real RDP session, never inferred from RDP credentials. */
export function RdpCagentInstallGuide({ name, address, busy, onOpenDesktop }: {
  name: string;
  address: string;
  busy: boolean;
  onOpenDesktop: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const run = async (action: () => Promise<void>) => {
    setError('');
    try { await action(); } catch { setError('操作未完成，请重试。也可以手动复制下方地址。'); }
  };
  return <section className="rdp-install-guide" aria-label="Windows CAgent 安装指引">
    <header><span className="rdp-install-icon"><Package size={24} /></span><div><h2>为这台 Windows 添加 CAgent</h2><p>{name} <span>· {address}</span></p></div></header>
    <p className="rdp-install-intro">在远程桌面中完成安装，再把连接信息带回 CShell。</p>
    <ol className="rdp-install-steps">
      <li><div><h3>打开这台机器的远程桌面</h3><p>使用当前 RDP 连接登录目标 Windows。</p><button type="button" disabled={busy} onClick={onOpenDesktop}><Monitor size={15} />{busy ? '正在打开…' : '打开远程桌面'}</button></div></li>
      <li><div><h3>在远端下载并安装</h3><p>复制地址，在远程 Windows 的浏览器中打开，选择 CAgent Windows 安装包。</p><div className="rdp-install-download"><code>{windowsDownloadPage}</code><button type="button" onClick={() => void run(async () => { await window.cshell.copyText(windowsDownloadPage); setCopied(true); })}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? '已复制下载地址' : '复制下载地址'}</button></div><button type="button" className="rdp-install-link" onClick={() => void run(() => window.cshell.clientDownloadPage('windows'))}><Download size={14} />本机打开下载页</button><p className="rdp-install-note">可选择专用安装目录。安装及系统权限提示在目标 Windows 确认。</p></div></li>
      <li><div><h3>设置 CAgent 的连接与权限</h3><p>在目标机器打开 CAgent，设置连接密码与允许的能力，再复制连接信息。连接信息不包含密码。</p></div></li>
      <li><div><h3>回到 CShell，添加 CAgent 连接</h3><p>选择新建连接中的 CAgent，粘贴连接信息；核对设备身份后输入密码。原 RDP 连接仍保留。</p></div></li>
    </ol>
    {copied && <p className="rdp-install-status" role="status">下载地址已复制，可在远程桌面的浏览器中粘贴。</p>}
    {error && <p role="alert" className="form-error">{error}</p>}
    <p className="rdp-install-note">RDP 登录不会自动授予远程安装权限，也不会代替目标机器确认系统提权。</p>
  </section>;
}

export function RdpMachineWorkspace({profile,active=true}:{profile:Profile;active?:boolean;profiles:Profile[];onOpen:(p:Profile)=>void}) {
 const [guide,setGuide]=useState(false);const host=useRef<HTMLDivElement>(null);const [status,setStatus]=useState({state:'connecting',message:'正在连接远程桌面'});const [attempt,setAttempt]=useState(0);
 useEffect(()=>{let alive=true,started=false;void window.cshell.openRdp(profile.id).then(()=>{started=true;}).catch(e=>{if(alive)setStatus({state:'failed',message:String(e.message||e)});});const timer=setInterval(()=>{if(!started)return;void window.cshell.rdpStatus(profile.id).then(s=>{if(alive)setStatus(s);}).catch(()=>{});},300);return()=>{alive=false;clearInterval(timer);void window.cshell.rdpClose(profile.id);};},[profile.id,attempt]);
 useEffect(()=>{const update=()=>{const r=host.current?.getBoundingClientRect();const overlay=Array.from(document.querySelectorAll('[role="dialog"],[role="menu"],details[open],.context-menu,.command-palette')).some(el=>el.getClientRects().length>0);if(r)void window.cshell.rdpBounds(profile.id,{x:Math.max(0,r.x),y:Math.max(0,r.y),width:r.width,height:r.height,visible:active&&!guide&&!overlay&&!document.hidden&&r.width>0&&r.height>0}).catch(()=>{});};update();const timer=setInterval(update,200);const observer=new ResizeObserver(update);if(host.current)observer.observe(host.current);const mutations=new MutationObserver(update);mutations.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open','hidden','class','style']});document.addEventListener('visibilitychange',update);window.addEventListener('resize',update);return()=>{clearInterval(timer);observer.disconnect();mutations.disconnect();document.removeEventListener('visibilitychange',update);window.removeEventListener('resize',update);};},[active,guide,profile.id,attempt]);
 return <section style={{height:'100%',display:'flex',flexDirection:'column',minHeight:0}} aria-label="远程桌面"><header style={{display:'flex',alignItems:'center',gap:12,padding:'8px 12px'}}><Monitor size={16}/><strong>{profile.name}</strong><span role="status">{status.message}</span><button onClick={()=>setGuide(v=>!v)}>{guide?'返回远程桌面':'安装 CAgent'}</button>{['failed','closed'].includes(status.state)&&<button onClick={()=>setAttempt(n=>n+1)}>重新连接</button>}</header>{guide&&<div style={{overflow:'auto'}}><RdpCagentInstallGuide name={profile.name} address={`${profile.host}:${profile.port}`} busy={false} onOpenDesktop={()=>setGuide(false)}/></div>}<div ref={host} style={{flex:1,minHeight:0,position:'relative',display:guide?'none':undefined}} /></section>;
}

