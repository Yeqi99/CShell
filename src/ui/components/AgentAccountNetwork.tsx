import { useEffect, useState } from 'react';
import { ArrowRight, Check, Globe, Network, ShieldCheck } from 'lucide-react';
import type { AgentCall } from '../../shared/agent';
import './agent-account-network.css';
type Status = {
  source: string;
  target: string | null;
  ready: boolean;
  error: string;
  proxy: string | null;
  devices: { deviceId: string; name: string; online: boolean }[];
};
export function AgentAccountNetwork({
  call,
}: {
  call: (method: AgentCall['method'], params?: unknown) => Promise<any>;
}) {
  const [status, setStatus] = useState<Status>(),
    [selected, setSelected] = useState<string | null>(null),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    const update = () =>
      call('network.status')
        .then((s) => {
          if (alive) {
            setStatus(s);
            if (!dirty) setSelected(s.target);
          }
        })
        .catch(() => {
          if (alive) setError('请确认此机器已更新 cagent，并登录 Pro 会员账号。');
        });
    void update();
    const timer = setInterval(update, 10000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [call, dirty]);
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      setStatus(await call('network.configure', { target: selected }));
      setDirty(false);
    } catch (e) {
      setError(String(e).replace(/^Error: /, ''));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="account-network">
      <header>
        <span className="network-symbol">
          <Network size={22} />
        </span>
        <div>
          <h2>
            网络出口 <small>PRO</small>
          </h2>
          <p>为这台机器选择应用访问网络的出口。</p>
        </div>
      </header>
      <div className="network-summary">
        <Globe size={18} />
        <span>当前机器</span>
        <ArrowRight size={16} />
        <strong>
          {status?.target
            ? (status.devices.find((d) => d.deviceId === status.target)?.name ?? '所选机器')
            : '本机网络'}
        </strong>
        <span className={'network-state ' + (status?.target && !status.ready ? 'unavailable' : '')}>
          {!status ? '正在检查' : status.target ? (status.ready ? '已连接' : '出口不可用') : '直连'}
        </span>
      </div>
      <fieldset disabled={busy || !status}>
        <legend>选择出口</legend>
        <div className="network-options">
          <button
            type="button"
            aria-pressed={selected === null}
            onClick={() => {
              setSelected(null);
              setDirty(true);
            }}
          >
            <Globe size={18} />
            <span>
              <strong>本机网络</strong>
              <small>使用这台机器自己的网络</small>
            </span>
            {selected === null && <Check size={16} />}
          </button>
          {status?.devices
            .filter((d) => d.deviceId !== status.source)
            .map((d) => (
              <button
                key={d.deviceId}
                type="button"
                aria-pressed={selected === d.deviceId}
                disabled={!d.online && selected !== d.deviceId}
                onClick={() => {
                  setSelected(d.deviceId);
                  setDirty(true);
                }}
              >
                <Network size={18} />
                <span>
                  <strong>{d.name}</strong>
                  <small>{d.online ? '在线 · 同账号机器' : '当前离线'}</small>
                </span>
                {selected === d.deviceId && <Check size={16} />}
              </button>
            ))}
        </div>
      </fieldset>
      <div className="network-scope">
        <ShieldCheck size={17} />
        <div>
          <strong>应用代理</strong>
          <p>
            用于 cagent 浏览器、HTTP 请求，以及新开终端中支持 ALL_PROXY 的程序。已有终端、WSL
            和系统其他软件保持原有网络。
          </p>
          {status?.proxy && <code>{status.proxy}</code>}
          <p>出口断开时，代理请求会停止，不自动切换网络。</p>
        </div>
      </div>
      {error && (
        <p role="alert" className="network-error">
          {error}
        </p>
      )}
      {status?.target && status.error && (
        <p role="status" className="network-error">
          {status.error}
        </p>
      )}
      <footer>
        <span>{dirty ? '有尚未应用的更改' : '设置随账号保留'}</span>
        <button className="primary" disabled={!dirty || busy} onClick={() => void save()}>
          {busy ? '正在应用…' : '应用更改'}
        </button>
      </footer>
    </section>
  );
}
