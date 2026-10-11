import { useEffect, useState } from 'react';
import { Plus, Trash2, Save, RefreshCw, Search } from 'lucide-react';
import type { LocalEnvironment } from '../../shared/local-terminal';
export function LocalEnvironmentSettings() {
  const [rows, setRows] = useState<LocalEnvironment>([]),
    [inherited, setInherited] = useState<LocalEnvironment>([]);
  const [error, setError] = useState(''),
    [status, setStatus] = useState(''),
    [busy, setBusy] = useState(false),
    [query, setQuery] = useState('');
  const load = async () => {
    setBusy(true);
    try {
      const s = await window.cshell.localEnvironment();
      setRows(s.overrides);
      setInherited(s.inherited);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  return (
    <section className="local-environment">
      <header>
        <div>
          <h2>本机终端</h2>
          <p className="muted">CMD 和 PowerShell 继承 Windows 环境变量。覆盖配置仅用于新会话。</p>
        </div>
      </header>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="local-env-heading">
        <h3>CShell 覆盖配置</h3>
        <button
          className="icon"
          title="添加环境变量"
          aria-label="添加环境变量"
          onClick={() => setRows([...rows, { name: '', value: '' }])}
        >
          <Plus size={15} />
        </button>
      </div>
      {!rows.length && <p className="muted">未设置覆盖，直接使用系统与用户环境变量。</p>}
      {rows.map((row, i) => (
        <div className="local-env-row" key={i}>
          <input
            aria-label={`变量名称 ${i + 1}`}
            placeholder="变量名称"
            value={row.name}
            onChange={(e) =>
              setRows(rows.map((r, n) => (n === i ? { ...r, name: e.target.value } : r)))
            }
          />
          <input
            aria-label={`变量值 ${i + 1}`}
            placeholder="变量值（留空表示空值）"
            value={row.value}
            onChange={(e) =>
              setRows(rows.map((r, n) => (n === i ? { ...r, value: e.target.value } : r)))
            }
          />
          <button
            className="icon"
            title="移除覆盖，恢复继承"
            aria-label={`移除环境变量 ${i + 1}`}
            onClick={() => setRows(rows.filter((_, n) => n !== i))}
          >
            <Trash2 size={15} />
          </button>
        </div>
      ))}
      <div className="local-env-actions">
        <span role="status">{status}</span>
        <button className="secondary" disabled={busy} onClick={() => void load()}>
          <RefreshCw size={14} />
          重新读取
        </button>
        <button
          className="primary"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError('');
            void window.cshell
              .saveLocalEnvironment(rows)
              .then(() => setStatus('已保存，下次新建终端生效'))
              .catch((e) => setError(e.message))
              .finally(() => setBusy(false));
          }}
        >
          <Save size={14} />
          保存环境变量
        </button>
      </div>
      <details className="local-env-inherited">
        <summary>查看继承的系统环境变量 · {inherited.length} 项</summary>
        <label>
          <Search size={14} />
          <input
            aria-label="搜索系统环境变量"
            placeholder="按名称搜索"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <dl>
          {inherited
            .filter((r) => r.name.toLowerCase().includes(query.toLowerCase()))
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((r) => (
              <div key={r.name}>
                <dt>{r.name}</dt>
                <dd>{r.value}</dd>
              </div>
            ))}
        </dl>
      </details>
    </section>
  );
}
