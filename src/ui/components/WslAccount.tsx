import { useState } from 'react';
import { Terminal, ArrowRight } from 'lucide-react';
export function WslAccount({
  distribution,
  onReady,
  onCancel,
  onBusy,
}: {
  distribution: string;
  onReady: () => Promise<void>;
  onCancel: () => void;
  onBusy: (busy: boolean) => void;
}) {
  const [username, setUsername] = useState('cshell'),
    [password, setPassword] = useState(''),
    [repeat, setRepeat] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <form
      className="wsl-account"
      onSubmit={(e) => {
        e.preventDefault();
        if (password !== repeat) {
          setError('两次密码不一致');
          return;
        }
        setBusy(true);
        onBusy(true);
        setError('');
        void window.cshell
          .wslInitialize({ distribution, username, password })
          .then(async () => {
            setPassword('');
            setRepeat('');
            await onReady();
          })
          .catch((e) => setError(e.message))
          .finally(() => {
            setBusy(false);
            onBusy(false);
          });
      }}
    >
      <Terminal size={24} />
      <h1>设置 {distribution}</h1>
      <p>首次使用，创建 Linux 用户。之后从左侧直接打开终端。</p>
      <label>
        Linux 用户名
        <input
          required
          pattern="[a-z_][a-z0-9_-]{0,30}"
          value={username}
          disabled={busy}
          onChange={(e) => setUsername(e.target.value)}
        />
      </label>
      <label>
        密码
        <input
          required
          type="password"
          autoComplete="new-password"
          value={password}
          disabled={busy}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <label>
        确认密码
        <input
          required
          type="password"
          autoComplete="new-password"
          value={repeat}
          disabled={busy}
          onChange={(e) => setRepeat(e.target.value)}
        />
      </label>
      <small>密码用于 Linux 内的 sudo 等授权，不用于每次打开终端。CShell 不保存此密码。</small>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <footer>
        <button type="button" className="secondary" disabled={busy} onClick={onCancel}>
          稍后设置
        </button>
        <button className="primary" disabled={busy}>
          <ArrowRight size={14} />
          {busy ? '正在初始化…' : '完成并打开终端'}
        </button>
      </footer>
    </form>
  );
}
