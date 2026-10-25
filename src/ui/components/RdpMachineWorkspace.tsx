import { useState } from 'react';
import { Check, Copy, Download, Monitor, Package } from 'lucide-react';
import type { Profile } from '../../shared/contracts';
import { LinuxDesktop } from './LinuxDesktop';
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

/** The native RDP viewer owns its connection status. */
export function RdpMachineWorkspace({ profile }: {
  profile: Profile;
  profiles: Profile[];
  onOpen: (profile: Profile) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('尚未打开远程桌面');
  const launch = async () => {
    if (busy) return;
    setBusy(true);
    try { await window.cshell.openRdp(profile.id); setMessage('已打开系统远程桌面，请在窗口内查看连接状态'); }
    catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  };
  return <LinuxDesktop name={profile.name} target={'rdp:' + profile.id}
    machine={{ platform: 'win32', deviceId: profile.id, desktopOnly: true, protocolLabel: 'RDP' }}
    active closed onRetry={() => void launch()} connectionLabel={busy ? '正在打开远程桌面' : message}
    call={async () => { throw Error('RDP 不提供管理通道'); }}
    extraPanels={[
      { id: 'remote-desktop', label: '远程桌面', icon: Monitor, content: <section className="machine-connection-card"><h2>{profile.name}</h2><p>{profile.host}:{profile.port}</p><button className="primary" disabled={busy} onClick={() => void launch()}>打开远程桌面</button><p role="status">{message}</p></section> },
      { id: 'install-cagent', label: '安装 CAgent', icon: Package, content: <RdpCagentInstallGuide name={profile.name} address={`${profile.host}:${profile.port}`} busy={busy} onOpenDesktop={() => void launch()} /> },
    ]} />;
}
