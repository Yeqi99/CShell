import { useState } from 'react';
import type { PingResult } from '../../shared/icmp-ping';

export function PingButton({ profileId, sessionId }: { profileId?: string; sessionId?: string }) {
  const [result, setResult] = useState<PingResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const detail = result?.status === 'unreachable' ? '未收到 ICMP 回应，不代表 SSH 离线'
    : result?.status === 'unsupported' ? '本机未安装 ping 工具' : '';
  return <button className="quiet ping-button"
    title={error || (result ? `本机 ICMP Ping · ${new Date(result.checkedAt).toLocaleTimeString()}${detail ? ' · ' + detail : ''}` : '从本机 Ping 此服务器')}
    aria-label="本机 Ping 服务器" disabled={busy}
    onClick={async event => {
      event.stopPropagation(); setBusy(true); setResult(null); setError('');
      try { setResult(await window.cshell.networkPing({ profileId, sessionId })); }
      catch (cause) { setError(cause instanceof Error ? cause.message : '检测未完成'); }
      finally { setBusy(false); }
    }}>
    {busy ? '检测中…' : error ? '重试' : result?.status === 'reply' ? `${result.lessThan ? '<' : ''}${result.elapsedMs} ms`
      : result?.status === 'unsupported' ? '不可用' : result ? '无响应' : 'Ping'}
  </button>;
}
