import {useState} from 'react';
import {Monitor,Package} from 'lucide-react';
import type {Profile} from '../../shared/contracts';
import {LinuxDesktop} from './LinuxDesktop';
/** An RDP credential is not a remote execution grant. The native viewer owns its connection status. */
export function RdpMachineWorkspace({profile,profiles,onOpen}:{profile:Profile;profiles:Profile[];onOpen:(profile:Profile)=>void}){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('尚未打开远程桌面'),[ssh,setSsh]=useState('');
 const launch=async()=>{if(busy)return;setBusy(true);try{await window.cshell.openRdp(profile.id);setMessage('已打开系统远程桌面，请在窗口内查看连接状态');}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}};
 return <LinuxDesktop name={profile.name} target={'rdp:'+profile.id} machine={{platform:'win32',deviceId:profile.id,desktopOnly:true,protocolLabel:'RDP'}} active closed onRetry={()=>void launch()} connectionLabel={busy?'正在打开远程桌面':message} call={async()=>{throw Error('RDP 不提供管理通道');}} extraPanels={[
  {id:'remote-desktop',label:'远程桌面',icon:Monitor,content:<section className="machine-connection-card"><h2>{profile.name}</h2><p>{profile.host}:{profile.port}</p><button className="primary" disabled={busy} onClick={()=>void launch()}>打开远程桌面</button><p role="status">{message}</p></section>},
  {id:'install-cagent',label:'安装 CAgent',icon:Package,content:<section className="machine-connection-card"><h2>在 Windows 上安装 CAgent</h2><p>仅有 RDP 信息不能远程执行安装。打开远程桌面后，可在目标机器下载并安装 CAgent；系统提权由目标机器确认。</p><p>若已为这台 Windows 配置 SSH，可选择对应连接，在其工作区检查安装条件。</p><label>已有 SSH 管理连接<select value={ssh} onChange={e=>setSsh(e.target.value)}><option value="">选择已保存的连接</option>{profiles.filter(p=>p.protocol==='ssh').map(p=><option key={p.id} value={p.id}>{p.name} · {p.host}</option>)}</select></label><button disabled={!ssh} onClick={()=>{const target=profiles.find(p=>p.id===ssh&&p.protocol==='ssh');if(target)onOpen(target);}}>打开所选管理连接</button><p>请核对目标地址，连接成功并确认安装计划后才会执行。</p></section>}
 ]}/>;
}
