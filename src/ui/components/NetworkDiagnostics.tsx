import { useEffect, useRef, useState } from 'react';
import { ArrowRight, RefreshCw, Activity } from 'lucide-react';
import type { NetworkDiagnostics as Options, NetworkProbeResult } from '../../shared/network-probe';
import { ErrorNotice } from './ErrorNotice';
export function NetworkDiagnostics() {
  const [options, setOptions] = useState<Options>({ sources: [], targets: [] });
  const [source, setSource] = useState('local'), [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [result, setResult] = useState<NetworkProbeResult>();
  const runId = useRef('');
  const refresh = async () => {
    try { setOptions(await window.cshell.networkDiagnostics!()); }
    catch (error) { setError(String(error)); }
  };
  useEffect(() => { void refresh(); return () => { if (runId.current) void window.cshell.networkProbeCancel?.(runId.current); }; }, []);
  const start = async () => {
    if (busy || !target) return;
    const id = crypto.randomUUID(); runId.current = id;
    setBusy(true); setError(''); setResult(undefined);
    try { const next = await window.cshell.networkProbe!({ id, source, target }); if (runId.current === id) setResult(next); }
    catch (error) { if (runId.current === id) setError(error instanceof Error ? error.message : String(error)); }
    finally { if (runId.current === id) { runId.current = ''; setBusy(false); } }
  };
  const endpoint = options.targets.find(t => t.id === target);
  return <details className="network-diagnostics">
    <summary><Activity size={16}/>连接延迟测试</summary>
    <p className="network-note">测量来源机器到目标地址的 TCP 建连耗时，包含地址解析，不是 ICMP Ping。不会经过上方模型代理。</p>
    <fieldset disabled={busy}>
      <div className="network-probe-select"><label>来源<select aria-label="来源机器" value={source} onChange={e => { setSource(e.target.value); setResult(undefined); }}>{options.sources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><ArrowRight size={16}/><label>目标连接<select aria-label="目标连接" value={target} onChange={e => { setTarget(e.target.value); setResult(undefined); }}><option value="" disabled>选择目标</option>{options.targets.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label><button className="icon" aria-label="刷新检测目标" title="刷新检测目标" onClick={() => void refresh()}><RefreshCw size={15}/></button></div>
      {endpoint && <p className="network-note">目标端口：{endpoint.host}:{endpoint.port}</p>}
    </fieldset>
    <div className="network-actions"><span>{busy ? '正在来源机器上采样…' : '每次 5 个样本，单次超时 2 秒'}</span>{busy ? <button onClick={() => void window.cshell.networkProbeCancel!(runId.current)}>取消检测</button> : <button className="secondary" disabled={!target || !options.sources.some(s => s.id === source)} onClick={() => void start()}>开始测试</button>}</div>
    {error && <ErrorNotice title="网络检测未完成" error={error}/>}
    {result && <div className="network-probe-result"><div className="network-probe-stats">{[['平均',result.averageMs],['最快',result.minimumMs],['最慢',result.maximumMs]].map(([name,value]) => <div key={name}><small>{name}</small><strong>{value === null ? '—' : value + ' ms'}</strong></div>)}<div><small>失败</small><strong>{result.failed} / {result.samples.length}</strong></div></div><ol>{result.samples.map((sample,i) => <li key={i}>{sample.elapsedMs === null ? sample.error : sample.elapsedMs + ' ms'}</li>)}</ol><small>测量时间：{new Date(result.startedAt).toLocaleString()}</small></div>}
  </details>;
}

