import { AlertCircle, RotateCw } from 'lucide-react';
import { CopyButton } from './AiCopyButton';
import './error-notice.css';

export function ErrorNotice({ error, title, retry, busy = false }: {
  error: string; title: string; retry?: () => void; busy?: boolean;
}) {
  if (!error) return null;
  const cleaned = error.replace(/Error invoking remote method '[^']*':\s*/g, '').replace(/^(Error:\s*)+/, '');
  const message = /503|502|504/.test(cleaned) ? '服务暂时无法响应，请稍后重试。模型请求也可以切换基座后重试。'
    : /401|403|permission|权限|access.denied/i.test(cleaned) ? '当前连接没有完成这项操作的权限。请在目标机器的设置与权限中检查授权。'
    : /断开|ECONN|timeout|超时|fetch failed/i.test(cleaned) ? '与服务的连接已中断或超时。请检查目标机器在线状态及网络，然后重试。'
    : /password|密码/i.test(cleaned) ? '连接密码未填写或不正确。请检查连接设置后重新连接。'
    : /TypeError|ReferenceError|SyntaxError|\bstack\b|\[\s*\{|too_small/i.test(cleaned) ? '应用未能完成这项操作。请重试；若仍然失败，可复制下面的诊断详情反馈。'
    : cleaned.length < 220 ? cleaned : '操作未完成。可以展开诊断详情查看具体原因。';
  const details = cleaned.replace(/(Bearer\s+)[^\s"']+/gi, '$1[已隐藏]').replace(/((?:api[_-]?key|password|token)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, '$1[已隐藏]');
  return <section className="error-notice" role="alert">
    <AlertCircle size={18} aria-hidden="true" />
    <div className="error-notice-body"><strong>{title}</strong><p>{message}</p>
      <details><summary>诊断详情</summary><div className="error-notice-details"><pre>{details}</pre><CopyButton content={details} /></div></details>
    </div>
    {retry && <button disabled={busy} onClick={retry}><RotateCw size={14} />重试</button>}
  </section>;
}
