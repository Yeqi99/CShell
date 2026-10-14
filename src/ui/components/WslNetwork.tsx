import { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import type { WslNetworkState } from '../../shared/wsl-network';
import './wsl-network.css';
export function WslNetwork() {
  const { locale } = useI18n();
  const cn = locale === 'zh-CN';
  const [state, setState] = useState<WslNetworkState>();
  const [mode, setMode] = useState('nat'),
    [proxy, setProxy] = useState(true);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const accept = (next: WslNetworkState) => {
    setState(next);
    setMode(next.mode);
    setProxy(next.autoProxy);
  };
  useEffect(() => {
    let active = true;
    void window.cshell
      .wslNetwork()
      .then((s) => {
        if (active) accept(s);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const dirty = !!state && (mode !== state.mode || proxy !== state.autoProxy);
  return (
    <details className="wsl-network">
      <summary>{cn ? '网络与代理' : 'Network and proxy'}</summary>
      <p>
        {cn
          ? '设置作用于当前 Windows 用户的所有 WSL 2 发行版。保存不会中断当前会话，下次完全重启 WSL 后生效。'
          : 'Applies to all WSL 2 distributions for this Windows user. Saving keeps sessions running; changes apply after WSL fully restarts.'}
      </p>
      {state ? (
        <fieldset disabled={busy}>
          <label>
            {cn ? '网络模式' : 'Network mode'}
            <select
              aria-label={cn ? '网络模式' : 'Network mode'}
              value={mode}
              onChange={(e) => setMode(e.target.value)}
            >
              {!['nat', 'mirrored'].includes(state.mode) && (
                <option value={state.mode}>{state.mode}</option>
              )}
              <option value="nat">NAT · {cn ? '默认' : 'Default'}</option>
              <option value="mirrored" disabled={!state.mirroredSupported}>
                {cn ? '镜像网络 · 与 Windows 互通 localhost' : 'Mirrored · shared localhost access'}
              </option>
            </select>
          </label>
          {!state.mirroredSupported && (
            <p>
              {cn
                ? '镜像网络需要 Windows 11 22H2 和 WSL 2.0 或更高版本。'
                : 'Mirrored networking requires Windows 11 22H2 and WSL 2.0 or newer.'}
            </p>
          )}
          <label className="wsl-network-check">
            <input type="checkbox" checked={proxy} onChange={(e) => setProxy(e.target.checked)} />
            {cn ? '跟随 Windows 代理' : 'Use Windows proxy settings'}
          </label>
          {state.localhostProxy && mode === 'nat' && proxy && (
            <p className="wsl-network-note">
              {cn
                ? 'Windows 正在使用 localhost 代理。NAT 模式无法直接继承这个地址；可选择镜像网络，或关闭代理继承让 WSL 自行联网。'
                : 'Windows uses a localhost proxy, which NAT cannot inherit directly. Choose mirrored networking or disable proxy inheritance for independent networking.'}
            </p>
          )}
          <div className="wsl-network-actions">
            <button
              className="primary"
              disabled={!dirty || !['nat', 'mirrored'].includes(mode)}
              onClick={() =>
                void run(async () => {
                  accept(
                    await window.cshell.saveWslNetwork({
                      revision: state.revision,
                      mode: mode as 'nat' | 'mirrored',
                      autoProxy: proxy,
                    }),
                  );
                  setMessage(
                    cn ? '已保存，完全重启 WSL 后生效。' : 'Saved. Fully restart WSL to apply.',
                  );
                })
              }
            >
              {cn ? '保存设置' : 'Save settings'}
            </button>
            <button
              className="secondary"
              disabled={dirty}
              onClick={() =>
                void run(async () => {
                  if (await window.cshell.restartWsl())
                    setMessage(
                      cn
                        ? 'WSL 已关闭，下次打开终端将使用新配置。'
                        : 'WSL shut down. The next terminal will use the new configuration.',
                    );
                })
              }
            >
              {cn ? '重启 WSL…' : 'Restart WSL…'}
            </button>
            <button
              className="secondary"
              onClick={() => void run(async () => accept(await window.cshell.wslNetwork()))}
            >
              {cn ? '重新读取' : 'Reload'}
            </button>
          </div>
        </fieldset>
      ) : (
        !error && <p role="status">{cn ? '读取设置…' : 'Reading settings…'}</p>
      )}
      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </details>
  );
}
