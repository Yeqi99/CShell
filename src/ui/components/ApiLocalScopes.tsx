import { useEffect, useState } from 'react';
import type { LocalShell } from '../../shared/local-terminal';
import { useI18n } from '../i18n';
export function ApiLocalScopes({
  value = [],
  change,
}: {
  value?: LocalShell[];
  change: (value: LocalShell[]) => void;
}) {
  const [available, setAvailable] = useState<LocalShell[]>([]);
  const [error, setError] = useState('');
  const { locale } = useI18n();
  const cn = locale === 'zh-CN';
  useEffect(() => {
    void window.cshell
      .apiLocalShells()
      .then(setAvailable)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <details>
      <summary>{cn ? '本机环境范围' : 'Local environment scope'}</summary>
      <p className="muted">
        {cn
          ? '与远端机器范围分别授权；还需勾选终端读取或输入权限。'
          : 'Separate from remote machine scope; terminal read or input permission is also required.'}
      </p>
      {error && <p role="alert">{error}</p>}
      {[...new Set([...available, ...value])].map((shell) => (
        <label className="checkbox" key={shell}>
          <input
            type="checkbox"
            checked={value.includes(shell)}
            disabled={!available.includes(shell) && !value.includes(shell)}
            onChange={(e) =>
              change(e.target.checked ? [...value, shell] : value.filter((s) => s !== shell))
            }
          />
          {shell}
          {!available.includes(shell) ? (cn ? '（当前不可用）' : ' (unavailable)') : ''}
        </label>
      ))}
    </details>
  );
}
