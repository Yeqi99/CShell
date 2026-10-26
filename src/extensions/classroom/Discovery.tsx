import { useEffect, useRef, useState } from 'react';
import { Monitor, RefreshCw, ShieldCheck, ArrowLeft, CheckCircle2 } from 'lucide-react';
import type { AgentLanBridge, AgentLanEnrollmentResult, AgentLanPrepared, AgentLanStatus } from '../../shared/agent-lan';
import './discovery.css';

export function ClassroomDiscovery({ api, onAdded }: { api: AgentLanBridge; onAdded?: () => void }) {
  const [status, setStatus] = useState<AgentLanStatus | null>(null);
  const [selected, setSelected] = useState<string[]>([]), [prepared, setPrepared] = useState<AgentLanPrepared | null>(null);
  const [password, setPassword] = useState(''), [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState<'check' | 'join' | null>(null), [error, setError] = useState('');
  const [result, setResult] = useState<AgentLanEnrollmentResult | null>(null);
  const alive = useRef(false), running = useRef(false);
  useEffect(() => {
    alive.current = true;let stopped = false, timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try { const next = await api.status();if (!stopped) { setStatus(next);setSelected(ids => ids.filter(id => next.sources.some(s => s.id === id))); } }
      catch { if (!stopped) setError('无法读取机房发现状态，请检查扩展是否已启用'); }
      finally { if (!stopped) timer = setTimeout(refresh, 2500); }
    };
    void refresh();return () => { stopped = true;alive.current = false;clearTimeout(timer); };
  }, [api]);
  const prepare = async () => {
    if (running.current || !selected.length) return;
    running.current = true;setBusy('check');setError('');setResult(null);setPassword('');setConfirmed(false);
    try { const value = await api.prepare(selected);if (alive.current) setPrepared(value); }
    catch (e) { if (alive.current) setError(e instanceof Error ? e.message : '设备身份检查未完成'); }
    finally { running.current = false;if (alive.current) setBusy(null); }
  };
  const enroll = async () => {
    if (running.current || !prepared || !confirmed || !password || Date.now() >= prepared.expiresAt) return;
    const secret = password;setPassword('');running.current = true;setBusy('join');setError('');
    try {
      const value = await api.confirm({ token: prepared.token, confirmed: true, password: secret,
        fingerprints: prepared.candidates.map(({ id, fingerprint }) => ({ id, fingerprint })) });
      if (alive.current) { setResult(value);setPrepared(null);setConfirmed(false);setSelected(ids => ids.filter(id => !value.devices.some(d => d.deviceId === id)));if (value.devices.length) onAdded?.(); }
    } catch (e) { if (alive.current) { setError(e instanceof Error ? e.message : '批量认证未完成，请重新检查身份');setPrepared(null);setConfirmed(false); } }
    finally { running.current = false;if (alive.current) setBusy(null); }
  };
  const expired = !!prepared && Date.now() >= prepared.expiresAt;
  const failures = prepared?.failures ?? result?.failures ?? [];
  return <section className="classroom-enrollment" aria-label="发现并加入机房设备">
    <div className="classroom-heading"><div><h2>机房设备</h2><p>自动发现局域网 CAgent，核对身份后一次加入。</p></div>
      <span className="classroom-enrollment-state">{status?.enabled ? '正在发现' : '发现未启用'}</span></div>
    <p className="classroom-enrollment-note">发现不代表授权。加入时才发送你填写的密码，后续管理仍受每台机器的权限限制。</p>
    {(error || status?.error) && <div className="classroom-error" role="alert">{error || status?.error}<button disabled={!!busy} aria-label="刷新机房发现" onClick={() => { setError('');void api.status().then(value => { if (alive.current) setStatus(value); }).catch(() => { if (alive.current) setError('刷新未完成'); }); }}><RefreshCw size={16}/></button></div>}
    {result && <p className="classroom-enrollment-result" role="status"><CheckCircle2 size={18}/>{result.devices.length} 台已加入连接列表{result.failures.length ? `，${result.failures.length} 台未完成` : ''}</p>}
    {!prepared ? <>
      {!status ? <p role="status">正在读取设备列表…</p> : !status.enabled ? <p>启用机房扩展后开始发现；不会扫描端口或自动登录设备。</p> : !status.sources.length ? <div className="classroom-enrollment-empty"><Monitor size={24}/><p>尚未发现设备。请确认 CAgent 已启用机房公告、启动监听，并与主控处于同一局域网。</p></div> : <>
        <div className="classroom-enrollment-actions"><span>发现 {status.sources.length} 台 · 已选 {selected.length} 台</span><button disabled={!!busy} onClick={() => setSelected(selected.length ? [] : status.sources.slice(0, 64).map(s => s.id))}>{selected.length ? '取消选择' : '选择全部（最多64台）'}</button></div>
        <div className="classroom-enrollment-list">{status.sources.map(source => <label key={source.id} className="classroom-enrollment-row">
          <input type="checkbox" checked={selected.includes(source.id)} disabled={!!busy || (!selected.includes(source.id) && selected.length >= 64)} onChange={event => setSelected(ids => event.target.checked ? [...ids, source.id] : ids.filter(id => id !== source.id))}/>
          <span><strong>{source.name}</strong><small>{source.room || '未指定机房'} · {source.address}:{source.port}</small></span><span className="classroom-enrollment-unverified">未认证</span>
        </label>)}</div>
        <button className="primary classroom-enrollment-submit" disabled={!!busy || !selected.length} onClick={() => void prepare()}><ShieldCheck size={17}/>{busy === 'check' ? '正在核验身份…' : `检查所选 ${selected.length} 台身份`}</button>
      </>}
    </> : <>
      <button className="classroom-enrollment-back" disabled={!!busy} onClick={() => { setPrepared(null);setConfirmed(false);setPassword(''); }}><ArrowLeft size={16}/>返回设备列表</button>
      <h3>确认设备身份</h3><p>以下指纹来自直接连接核验。请与机房设备提供的身份对应，确认后再加入。</p>
      <div className="classroom-enrollment-identities">{prepared.candidates.map(source => <div key={source.id}><strong>{source.name}</strong><span>{source.address}:{source.port} · {source.room || '未指定机房'}</span><code>{source.fingerprint}</code></div>)}</div>
      {expired ? <p role="alert">身份检查已过期，请返回列表重新检查。</p> : prepared.candidates.length > 0 && <form onSubmit={event => { event.preventDefault();void enroll(); }}>
        <label className="classroom-enrollment-confirm"><input type="checkbox" checked={confirmed} disabled={!!busy} onChange={event => setConfirmed(event.target.checked)}/>我已核对这 {prepared.candidates.length} 台机房设备的身份</label>
        <label className="classroom-enrollment-password">本批设备密码<input type="password" value={password} autoComplete="off" maxLength={128} disabled={!!busy} onChange={event => setPassword(event.target.value)} placeholder="输入机房部署时设置的密码"/></label>
        <button className="primary classroom-enrollment-submit" type="submit" disabled={!!busy || !confirmed || !password}><ShieldCheck size={17}/>{busy === 'join' ? '正在逐台认证…' : `认证并加入 ${prepared.candidates.length} 台`}</button>
      </form>}
    </>}
    {!!failures.length && <details className="classroom-enrollment-failures" open><summary>{failures.length} 台未完成</summary><ul>{failures.map(item => <li key={item.id}><strong>{status?.sources.find(s => s.id === item.id)?.name || item.id}</strong><span>{item.error}</span></li>)}</ul></details>}
  </section>;
}
