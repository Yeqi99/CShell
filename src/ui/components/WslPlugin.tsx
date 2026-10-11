import { useEffect, useState } from 'react';
import { Terminal, RefreshCw, Copy, ShieldCheck } from 'lucide-react';
import type { LocalShell, WslSetupState } from '../../shared/local-terminal';
export function WslPlugin({ onOpen }: { onOpen: (shell: LocalShell) => Promise<void> }) {
  const [state, setState] = useState<{
      available: boolean;
      distributions: string[];
      error?: string;
    } | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [ubuntu, setUbuntu] = useState(true),
    [setup, setSetup] = useState<WslSetupState>({ phase: 'idle' }),
    [copied, setCopied] = useState(false);
  const refresh = async () => {
    setBusy(true);
    setError('');
    try {
      setState(await window.cshell.wslDistributions());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void refresh();
    let active = true;
    let previous = '';
    const poll = async () => {
      try {
        const next = await window.cshell.wslInstallStatus();
        if (!active) return;
        setSetup(next);
        if (previous === 'running' && next.phase !== 'running') void refresh();
        previous = next.phase;
      } catch {
        /* Keep the current install state if the window is closing. */
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 1500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  return (
    <section className="wsl-plugin">
      <div className="local-env-heading">
        <h2>Linux 发行版</h2>
        <button
          className="icon"
          aria-label="刷新 WSL"
          title="刷新 WSL"
          disabled={busy}
          onClick={() => void refresh()}
        >
          <RefreshCw size={15} />
        </button>
      </div>
      <p className="muted">使用本机 Windows Subsystem for Linux，终端运行在所选发行版中。</p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {setup.message && (
        <p role="status" className={setup.phase === 'error' ? 'form-error' : 'muted'}>
          {setup.message}
        </p>
      )}
      {setup.details && (
        <details className="wsl-install-log" open={setup.phase === 'error'}>
          <summary>系统安装输出</summary>
          <pre>{setup.details}</pre>
        </details>
      )}
      {state?.distributions.map((name) => (
        <div className="wsl-distribution" key={name}>
          <Terminal size={20} />
          <div>
            <strong>{name}</strong>
            <small>WSL · 本机 Linux</small>
          </div>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void onOpen(`wsl:${name}`)
                .catch((e) => setError(e.message))
                .finally(() => setBusy(false));
            }}
          >
            打开终端
          </button>
        </div>
      ))}
      {!state && <p role="status">正在检测 WSL…</p>}
      {state && !state.distributions.length && (
        <div className="ai-provider-empty">
          <div>
            <strong>{state.available ? '尚未安装 Linux 发行版' : 'WSL 暂不可用'}</strong>
            <p>{state.error || '在 Windows 安装发行版后，点击刷新。'}</p>
            <label className="wsl-install-option">
              <input
                type="checkbox"
                checked={ubuntu}
                disabled={setup.phase === 'running'}
                onChange={(e) => setUbuntu(e.target.checked)}
              />
              同时安装 Ubuntu
            </label>
            <p className="muted">
              将启用 Windows Linux 与虚拟化组件，可能需要重启。不会自动重启或修改已有发行版。
            </p>
            <button
              className="primary"
              disabled={setup.phase === 'running'}
              onClick={() => {
                setError('');
                void window.cshell
                  .wslInstall(ubuntu)
                  .then(setSetup)
                  .catch((e) => setError(e.message));
              }}
            >
              <ShieldCheck size={15} />
              {setup.phase === 'running'
                ? '正在安装…'
                : ubuntu
                  ? '启用 WSL 并安装 Ubuntu'
                  : '启用 WSL'}
            </button>
            <button
              className="secondary"
              onClick={() =>
                void window.cshell
                  .copyText(
                    ubuntu
                      ? 'wsl --install -d Ubuntu --no-launch'
                      : 'wsl --install --no-distribution',
                  )
                  .then(() => setCopied(true))
              }
            >
              <Copy size={14} />
              {copied ? '已复制' : '复制安装命令'}
            </button>
            <small>在管理员终端运行 wsl --install，按 Windows 提示完成安装，必要时重启。</small>
          </div>
        </div>
      )}
    </section>
  );
}
