import { useState } from 'react';
import type { PingResult } from '../../shared/icmp-ping';

export function PingButton({ profileId, sessionId }: { profileId?: string; sessionId?: string }) {
  const [result, setResult] = useState<PingResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const detail = result?.status === 'proxy-path' ? `经 ${result.routeInterface || '代理'} 路径，ICMP 可能由本机代理应答，无法确认服务器延迟`
    : result?.status === 'route-unknown' ? '无法确认本机出口路由，未将可能的代理应答显示为服务器延迟'
    : result?.status === 'unreachable' ? '未收到 ICMP 回应，不代表 SSH 离线'
    : result?.status === 'unsupported' ? '本机未安装 ping 工具' : '';
  return <button className="quiet ping-button"
    title={error || (result ? `本机 → ${result.targetAddress || '目标服务器'} · ICMP Ping · ${new Date(result.checkedAt).toLocaleTimeString()}${detail ? ' · ' + detail : ''}` : '从本机 Ping 此服务器')}
    aria-label="本机 Ping 服务器" disabled={busy}
    onClick={async event => {
      event.stopPropagation(); setBusy(true); setResult(null); setError('');
      try { setResult(await window.cshell.networkPing({ profileId, sessionId })); }
      catch (cause) { setError(cause instanceof Error ? cause.message : '检测未完成'); }
      finally { setBusy(false); }
    }}>
    {busy ? '检测中…' : error ? '重试' : result?.status === 'reply' ? `${result.lessThan ? '<' : ''}${result.elapsedMs} ms`
      : result?.status === 'proxy-path' ? '代理路径' : result?.status === 'route-unknown' ? '路由待确认'
      : result?.status === 'unsupported' ? '不可用' : result ? '无响应' : 'Ping'}
  </button>;
}
