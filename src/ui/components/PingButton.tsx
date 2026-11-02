import { useEffect, useState } from 'react';
import type { PingResult } from '../../shared/icmp-ping';
import {useDesktopText} from '../desktop-i18n';
import {useI18n} from '../i18n';

export function PingButton({ profileId, sessionId }: { profileId?: string; sessionId?: string }) {
  const tr=useDesktopText(),{locale}=useI18n();
  const [result, setResult] = useState<PingResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(()=>{const receive=(event:Event)=>{const value=(event as CustomEvent).detail;if(value?.profileId!==profileId)return;setResult(value.result??null);setError(value.error??'');};window.addEventListener('cshell:ping-result',receive);return()=>window.removeEventListener('cshell:ping-result',receive);},[profileId]);
  const detail = result?.status === 'proxy-path' ? locale==='en-US'?`Via ${result.routeInterface || 'proxy'}; a local proxy may have answered ICMP. Server latency is unverified.`:`经 ${result.routeInterface || '代理'} 路径，ICMP 可能由本机代理应答，无法确认服务器延迟`
    : result?.status === 'route-unknown' ? tr('无法确认本机出口路由，未将可能的代理应答显示为服务器延迟')
    : result?.status === 'unreachable' ? tr('未收到 ICMP 回应，不代表 SSH 离线')
    : result?.status === 'unsupported' ? tr('本机未安装 ping 工具') : '';
  return <button className="quiet ping-button"
    title={error || (result ? `${tr('本机')} → ${result.targetAddress || tr('目标服务器')} · ICMP Ping · ${new Date(result.checkedAt).toLocaleTimeString(locale)}${detail ? ' · ' + detail : ''}` : tr('从本机 Ping 此服务器'))}
    aria-label={tr('本机 Ping 服务器')} disabled={busy}
    onClick={async event => {
      event.stopPropagation(); setBusy(true); setResult(null); setError('');
      try { setResult(await window.cshell.networkPing({ profileId, sessionId })); }
      catch (cause) { setError(cause instanceof Error ? cause.message : tr('检测未完成')); }
      finally { setBusy(false); }
    }}>
    {busy ? tr('检测中…') : error ? tr('重试') : result?.status === 'reply' ? `${result.lessThan ? '<' : ''}${result.elapsedMs} ms`
      : result?.status === 'proxy-path' ? tr('代理路径') : result?.status === 'route-unknown' ? tr('路由待确认')
      : result?.status === 'unsupported' ? tr('不可用') : result ? tr('无响应') : 'Ping'}
  </button>;
}
