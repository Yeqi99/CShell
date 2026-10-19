import { useEffect, useState } from 'react';
import { Plus, RefreshCw, Search, Trash2, KeyRound } from 'lucide-react';
import './view.css';
const call = (action: string, input?: unknown) =>
  window.cshell.aiExtensionCall('cshell.tavily', action, input) as Promise<any>;
export function TavilyView() {
  const [state, setState] = useState<any>({ accounts: [], allowPaygo: false }),
    [name, setName] = useState(''),
    [key, setKey] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const run = async (action: string, input?: unknown) => {
    setBusy(true);
    setError('');
    try {
      const value = await call(action, input);
      setState(value);
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void run('status');
  }, []);
  return (
    <section className="tavily-extension">
      <header>
        <div className="tavily-mark">
          <Search size={24} />
        </div>
        <div>
          <h2>Tavily 搜索</h2>
          <p>为智能体提供带来源链接的网络搜索。</p>
        </div>
        <button
          disabled={busy}
          title="刷新用量（两分钟内复用缓存）"
          aria-label="刷新 Tavily 用量"
          onClick={() => void run('refresh')}
        >
          <RefreshCw size={17} />
          刷新用量
        </button>
      </header>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run('save', { name: name.trim() || `Key ${state.accounts.length + 1}`, key })) {
            setKey('');
            setName('');
          }
        }}
      >
        <label>
          <div>名称 <span>选填</span></div>
          <input
            value={name}
            maxLength={80}
            placeholder="例如个人账号、工作账号"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          API Key
          <input
            type="password"
            autoComplete="new-password"
            value={key}
            maxLength={512}
            placeholder="tvly-…"
            onChange={(e) => setKey(e.target.value)}
          />
        </label>
        <button className="primary" disabled={busy || key.trim().length < 8}>
          <Plus size={17} />
          {busy ? '处理中…' : '保存并检测'}
        </button>
      </form>
      {error && (
        <div role="alert" className="tavily-error">
          {error}
        </div>
      )}
      <div className="tavily-accounts">
        {state.accounts.map((a: any) => (
          <article key={a.id}>
            <div className="tavily-account-heading">
              <KeyRound size={18} />
              <strong>{a.name}</strong>
              <code>{a.maskedKey}</code>
              <label>
                <input
                  type="checkbox"
                  checked={a.enabled}
                  disabled={busy}
                  onChange={(e) =>
                    void run('save', { id: a.id, name: a.name, enabled: e.target.checked })
                  }
                />
                启用
              </label>
              <button
                title={`移除 ${a.name}`}
                aria-label={`移除 ${a.name}`}
                disabled={busy}
                onClick={() => void run('remove', { id: a.id })}
              >
                <Trash2 size={16} />
              </button>
            </div>
            {a.usage ? (
              <>
                <div className="tavily-quota">
                  <div>
                    <small>此 Key 已用 / 限额</small>
                    <b>
                      {a.usage.key.usage} / {a.usage.key.limit ?? '不限'}
                    </b>
                  </div>
                  <div>
                    <small>账号套餐 · {a.usage.account.current_plan}</small>
                    <b>
                      {a.usage.account.plan_usage} / {a.usage.account.plan_limit}
                    </b>
                  </div>
                  <div>
                    <small>可分配额度（估算）</small>
                    <b>{a.unlimited ? '不限' : (a.remaining ?? '未知')}</b>
                  </div>
                </div>
                {a.usage.key.limit > 0 && (
                  <progress
                    aria-label={`${a.name} 用量`}
                    max={a.usage.key.limit}
                    value={a.usage.key.usage}
                  />
                )}
              </>
            ) : (
              <p>{a.error || '尚未检测'}</p>
            )}
            {a.error && a.usage && <p role="status">{a.error}</p>}
            {a.checkedAt > 0 && <small>最近检测 {new Date(a.checkedAt).toLocaleString()}</small>}
          </article>
        ))}
      </div>
      {!state.accounts.length && (
        <p className="tavily-empty">
          添加 API Key 后自动检测用量。可以添加多个 Key，搜索优先使用剩余额度较多的可用 Key。
        </p>
      )}
      <footer>
        <label>
          <input
            type="checkbox"
            checked={state.allowPaygo}
            disabled={busy}
            onChange={(e) => void run('settings', { allowPaygo: e.target.checked })}
          />
          允许使用官方已配置的按量付费额度
        </label>
        <p>
          同账号的 Key
          共用账号套餐，不重复计算总余额。用量每两分钟刷新，本地调用消耗先做估算；网络结果不明时不会自动重试。
        </p>
        <p>在智能体访问权限中开启“网络搜索”后即可调用。密钥加密保存在本机，不会交给模型。</p>
      </footer>
    </section>
  );
}
