import { AlertCircle, RotateCw } from 'lucide-react';
import {useEffect} from 'react';
import { CopyButton } from './AiCopyButton';
import './error-notice.css';
const reported = new Map<string,number>();

export function ErrorNotice({ error, title, retry, busy = false }: {
  error: string; title: string; retry?: () => void; busy?: boolean;
}) {
  const cleaned = error.replace(/Error invoking remote method '[^']*':\s*/g, '').replace(/^(Error:\s*)+/, '')
    .replace(/(Bearer\s+)[^\s"']+/gi, '$1[已隐藏]')
    .replace(/((?:api[_-]?key|password|token)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, '$1[已隐藏]');
  const membership = /需要.*(?:Pro|会员)|membership.required/i.test(cleaned);
  const permission = !membership && /权限|permission.denied|access.denied|\b403\b/i.test(cleaned);
  const unavailable = !membership && !permission && /未开启|未启用|未就绪|未安装|未开放|not.ready|not.enabled|not.installed/i.test(cleaned);
  const notice = membership || permission || unavailable;
  const message = membership ? '此功能需要有效的 Pro 会员。可在账号设置中查看会员状态。'
    : /503|502|504/.test(cleaned) ? '服务暂时无法响应，请稍后重试。模型请求也可以切换基座后重试。'
    : /\b401\b|unauthorized|认证失败/i.test(cleaned) ? '连接身份未通过验证，请检查当前账号或重新认证此连接。'
    : /403|permission|权限|access.denied/i.test(cleaned) ? '当前连接没有完成这项操作的权限。请在目标机器的设置与权限中检查授权。'
    : /断开|ECONN|timeout|超时|fetch failed/i.test(cleaned) ? '与服务的连接已中断或超时。请检查目标机器在线状态及网络，然后重试。'
    : /password|密码/i.test(cleaned) ? '连接密码未填写或不正确。请检查连接设置后重新连接。'
    : /TypeError|ReferenceError|SyntaxError|\bstack\b|\[\s*\{|too_small/i.test(cleaned) ? '应用未能完成这项操作。请重试；若仍然失败，可复制下面的诊断详情反馈。'
    : cleaned.length < 220 ? cleaned : '操作未完成。可以展开诊断详情查看具体原因。';
  const details = cleaned.replace(/(Bearer\s+)[^\s"']+/gi, '$1[已隐藏]').replace(/((?:api[_-]?key|password|token)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, '$1[已隐藏]');
  useEffect(()=>{
    if(!details)return;
    const key=title+': '+details,now=Date.now();
    if(now-(reported.get(key)??0)<60000)return;
    reported.set(key,now);if(reported.size>128)reported.delete(reported.keys().next().value!);
    window.cshell?.reportError?.({message:key});
  },[details,title]);
  if (!error) return null;
  return <section className={`error-notice${notice ? ' error-notice-warning' : ''}`} role={notice ? 'status' : 'alert'}>
    <AlertCircle size={18} aria-hidden="true" />
    <div className="error-notice-body"><strong>{membership ? '会员功能' : permission ? '需要操作权限' : title}</strong><p>{message}</p>
      <details><summary>诊断详情</summary><div className="error-notice-details"><pre>{details}</pre><CopyButton content={details} /></div></details>
    </div>
    {retry && <button disabled={busy} onClick={retry}><RotateCw size={14} />重试</button>}
  </section>;
}
