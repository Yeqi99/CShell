import {RemoteAppNetwork} from './RemoteAppNetwork';
import { useEffect, useState } from 'react';
import { Globe, ArrowRight } from 'lucide-react';
import type { NetworkRoute, NetworkRouteStatus } from '../../shared/network-route';
import { ErrorNotice } from './ErrorNotice';
import { NetworkDiagnostics } from './NetworkDiagnostics';
import './network-settings.css';

export function NetworkSettings() {
  const [status, setStatus] = useState<NetworkRouteStatus>();
  const [mode, setMode] = useState<NetworkRoute['mode']>('system');
  const [url, setUrl] = useState('');
  const [machine, setMachine] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let alive = true;
    void window.cshell.networkStatus?.().then(value => {
      if (!alive) return;
      setStatus(value); setMode(value.route.mode);
      if (value.route.mode === 'proxy') setUrl(value.route.url);
      if (value.route.mode === 'machine') setMachine(value.route.id);
    }).catch(error => { if (alive) setError(error.message); });
    return () => { alive = false; };
  }, []);
  const apply = async () => {
    if (busy || !status) return;
    setBusy(true); setError(''); setSaved(false);
    try {
      const route: NetworkRoute = mode === 'direct' || mode === 'system' ? { mode } : mode === 'proxy' ? { mode, url } : { mode, id: machine };
      setStatus(await window.cshell.networkSave!(route));
      setSaved(true);
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return <section className="network-settings" aria-label="网络出口">
    <div className="network-heading"><Globe size={20}/><div><h2>本地模型请求的网络出口</h2><p>为手动配置的模型 API、连接测试和文本助手选择网络。</p></div></div>
    {error && <ErrorNotice title="网络设置未完成" error={error}/>}
    {!status && !error && <p role="status">正在读取网络设置…</p>}
    {status && <fieldset disabled={busy}>
      <div className="network-modes" role="group" aria-label="代理方式">
        {([['system','跟随系统'],['direct','直连'],['proxy','手动代理'],['machine','机器出口']] as [NetworkRoute['mode'],string][]).map(([value,label]) =>
          <button type="button" key={value} aria-pressed={mode === value} onClick={() => { setMode(value); setSaved(false); }}>{label}</button>)}
      </div>
      {mode === 'proxy' && <label>代理地址<input aria-label="代理地址" value={url} spellCheck={false} placeholder="http://127.0.0.1:7890" onChange={e => { setUrl(e.target.value); setSaved(false); }}/><small>支持无需认证的 HTTP、HTTPS、SOCKS5 代理。</small></label>}
      {mode === 'machine' && status.machines.length===0 && <p>先添加 SSH 或 CAgent 连接；首次使用需要核验身份及授权。</p>}
      {mode === 'machine' && <label>出口机器<select aria-label="本地模型出口机器" value={machine} onChange={e => { setMachine(e.target.value); setSaved(false); }}><option value="" disabled>选择机器</option>{!status.machines.some(m => m.id === machine) && machine && <option value={machine} disabled>原出口暂不可用</option>}{status.machines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>}
      <div className="network-path"><span>CShell</span><ArrowRight size={14}/><span>{mode === 'system' ? '系统代理设置' : mode === 'direct' ? '本机网络' : mode === 'proxy' ? '指定代理' : status.machines.find(m => m.id === machine)?.name ?? '所选机器'}</span><ArrowRight size={14}/><span>模型服务</span></div>
      <p className="network-note">默认跟随系统代理及其自动配置；系统未配置代理时直连。手动代理或机器出口不可用时会报错，不自动切回直连。应用后重新建立模型连接。</p>
      <div className="network-actions"><span role="status">{saved ? '已应用，后续请求使用新出口' : ''}</span><button className="primary" type="button" onClick={() => void apply()} disabled={mode === 'proxy' && !url || mode === 'machine' && !machine}>{busy ? '正在应用…' : '应用网络设置'}</button></div>
    </fieldset>}
    {status && window.cshell.networkRemoteOpen && <RemoteAppNetwork machines={status.machines}/>}
    {window.cshell.networkDiagnostics && <NetworkDiagnostics/>}
  </section>;
}
