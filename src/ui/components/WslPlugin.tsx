import { useEffect, useState } from 'react';
import { Terminal, RefreshCw, Copy } from 'lucide-react';
import type { LocalShell } from '../../shared/local-terminal';
export function WslPlugin({ onOpen }: { onOpen: (shell: LocalShell) => Promise<void> }) {
  const [state, setState] = useState<{
      available: boolean;
      distributions: string[];
      error?: string;
    } | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
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
            <button
              className="secondary"
              onClick={() =>
                void window.cshell.copyText('wsl --install').then(() => setCopied(true))
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
