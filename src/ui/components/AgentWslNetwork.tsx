import { useEffect, useState } from 'react';
import type { AgentCall } from '../../shared/agent';
import type { WslNetworkState } from '../../shared/wsl-network';
export function AgentWslNetwork({
  call,
}: {
  call: (method: AgentCall['method'], params?: unknown) => Promise<any>;
}) {
  const [state, setState] = useState<WslNetworkState>(),
    [mode, setMode] = useState('nat'),
    [proxy, setProxy] = useState(true),
    [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const accept = (s: WslNetworkState) => {
    setState(s);
    setMode(s.mode);
    setProxy(s.autoProxy);
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await fn();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    let alive = true;
    void call('wsl.network.read')
      .then((s) => alive && accept(s))
      .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, [call]);
  return (
    <details className="wsl-network">
      <summary>目标 Agent 的 WSL 网络与代理</summary>
      <p>仅修改所选 Windows Agent 的配置；保存不重启 WSL。</p>
      {state && (
        <fieldset disabled={busy}>
          <label>
            网络模式
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="nat">NAT</option>
              <option value="mirrored" disabled={!state.mirroredSupported}>
                镜像网络
              </option>
            </select>
          </label>
          <label className="agent-check">
            <input type="checkbox" checked={proxy} onChange={(e) => setProxy(e.target.checked)} />
            使用目标 Windows 的代理
          </label>
          {state.localhostProxy && mode === 'nat' && proxy && (
            <p>目标 Windows 使用 localhost 代理，NAT 无法直接继承这个地址。</p>
          )}
          <button
            onClick={() =>
              void run(async () => {
                accept(
                  await call('wsl.network.save', {
                    revision: state.revision,
                    mode,
                    autoProxy: proxy,
                  }),
                );
                setMessage('已保存，重启目标 WSL 后生效。');
              })
            }
          >
            保存目标网络设置
          </button>
          <label className="agent-check">
            <input
              type="checkbox"
              checked={confirm}
              onChange={(e) => setConfirm(e.target.checked)}
            />
            确认停止目标机器全部 WSL 会话和进程
          </label>
          <button
            disabled={!confirm || mode !== state.mode || proxy !== state.autoProxy}
            onClick={() =>
              void run(async () => {
                await call('wsl.network.apply', { confirmDisconnect: true });
                setConfirm(false);
                setMessage('目标 WSL 已关闭，下次打开时使用新配置。');
              })
            }
          >
            应用并关闭目标 WSL
          </button>
        </fieldset>
      )}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
    </details>
  );
}
