import { useEffect, useState } from 'react';
import {
  Check,
  ChevronDown,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  KeyRound,
  ExternalLink,
} from 'lucide-react';
import './view.css';
const call = (action: string, input?: unknown) =>
  window.cshell.aiExtensionCall('cshell.opencode', action, input) as Promise<any>;
type Account = { id: string; name: string; workspace: string; providerId?:string };
type Model = { id: string; available: boolean };
export function OpenCodeView() {
  const [runtime,setRuntime]=useState<{kind:string;version?:string;platformSupported?:boolean}>();
  const [login, setLogin] = useState<any>(null),
    [accounts, setAccounts] = useState<Account[]>([]),
    [selected, setSelected] = useState(''),
    [key, setKey] = useState(''),
    [name, setName] = useState(''),
    [workspace, setWorkspace] = useState(''),
    [editing, setEditing] = useState(false),
    [tier, setTier] = useState<'go' | 'zen'>('go'),
    [models, setModels] = useState<Model[]>([]),
    [model, setModel] = useState(''),
    [query, setQuery] = useState(''),
    [usage, setUsage] = useState<any>(null),
    [check, setCheck] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  const account = accounts.find((a) => a.id === selected);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage('');
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''));
    } finally {
      setBusy(false);
    }
  };
  const select = (a: Account) => {
    setSelected(a.id);
    setName(a.name);
    setWorkspace(a.workspace);
    setKey('');
    setCheck(null);
    setUsage(null);
    setEditing(false);
  };
  useEffect(() => {
    let active = true;
    void call('status')
      .then((s) => {
        if (active) {
          setAccounts(s.accounts);
          setRuntime(s.runtime);
          if (s.accounts.length) select(s.accounts[0]);
          else setEditing(true);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => window.cshell.onAiProvidersChanged(() => {
    void call('status').then(s => setAccounts(s.accounts)).catch(() => {});
  }), []);
  useEffect(() => {
    let active = true;
    setModels([]);
    setModel('');
    setCheck(null);
    setUsage(null);
    void call('models', { tier, refresh: true })
      .then((m) => {
        if (active) {
          setModels(m);
          setModel(m.find((v: Model) => v.available && /(?:^|-)free$/.test(v.id))?.id ?? '');
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [tier]);
  useEffect(() => {
    if (!login) return;
    let active = true,
      polling = false;
    const timer = setInterval(() => {
      if (polling) return;
      polling = true;
      void call('login-poll', { id: login.id })
        .then(async (s) => {
          if (!active || s.pending) return;
          setAccounts(s.accounts);
          select(s.accounts.find((a: Account) => a.id === s.id));
          setLogin(null);
          await call('connect', { id: s.id });
          setMessage('浏览器登录成功，账号模型已加入智能体');
        })
        .catch((e) => {
          if (active) {
            setError(e.message);
            setLogin(null);
          }
        })
        .finally(() => {
          polling = false;
        });
    }, login.interval * 1000);
    return () => {
      active = false;
      clearInterval(timer);
      void call('login-cancel', { id: login.id }).catch(() => {});
    };
  }, [login]);
  const verify = async (id: string, inference = false) => {
    setCheck(null);
    setUsage(null);
    if (!inference) {
      const connected=await call('connect', { id });
      setAccounts(previous=>previous.map(a=>a.id===id?{...a,providerId:connected.id}:a));
      setCheck({authenticated:true});
      try { setUsage(await call('usage', {id})); } catch {}
      setMessage('账号已验证并接入，可在智能体中选择 Go 与 Zen 模型');
      return;
    }
    const result = await call('check', { id, tier, ...(model ? { model } : {}) });
    setCheck(result);
    setModels(result.models);
    setModel(result.model);
    setUsage(result.usage);
    setMessage(
      `连接正常 · ${result.model} · ${result.elapsedMs} ms${result.usageError ? '；用量暂不可用：' + result.usageError : ''}`,
    );
  };
  return (
    <section className="opencode-extension">
      <header className="opencode-heading">
        <div>
          <h2>OpenCode</h2>
          <p>添加密钥，即可连接模型与 Go 套餐。</p>
        </div>
        <button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await call('open', { page: 'keys', id: selected || 'default' });
            })
          }
        >
          <ExternalLink size={16} /> 获取 API Key
        </button>
      </header>
      {runtime?.kind==='official' && <p className="opencode-note">{runtime.platformSupported ? `通过官方 OpenCode ${runtime.version} 运行。首次发送会下载并核验私有运行时；使用设置中的网络出口。模型权限、地区与额度仍以服务端结果为准。` : '此平台尚无已核验的官方运行时。账号仍保留，可继续管理目录与密钥。'}</p>}

      <div className="opencode-row">
        <button
          disabled={busy || !!login || accounts.length >= 32}
          onClick={() => void run(async () => setLogin(await call('login-start')))}
        >
          通过浏览器登录
        </button>
        {login && (
          <>
            <span>
              请在浏览器确认代码：<strong>{login.userCode}</strong>
            </span>
            <button onClick={() => setLogin(null)}>取消登录</button>
          </>
        )}
      </div>
      <div className="opencode-accounts" aria-label="OpenCode 账号">
        {accounts.map((a) => (
          <button
            key={a.id}
            disabled={busy}
            className={selected === a.id ? 'selected' : ''}
            onClick={() => select(a)}
          >
            <KeyRound size={16} />
            <span>{a.name}</span>
            {selected === a.id && <Check size={15} />}
          </button>
        ))}
        <button
          disabled={busy || accounts.length >= 32}
          onClick={() => {
            setSelected('');
            setName('');
            setKey('');
            setWorkspace('');
            setEditing(true);
            setCheck(null);
            setUsage(null);
          }}
        >
          <Plus size={16} /> 添加密钥
        </button>
      </div>
      <div className="opencode-card">
        <div className="opencode-row">
          <h3>{account?.name ?? '新账号'}</h3>
          {account && (
            <button disabled={busy} onClick={() => setEditing((v) => !v)}>
              编辑密钥 <ChevronDown size={14} />
            </button>
          )}
          <span className={'opencode-badge ' + (check || account?.providerId ? 'verified' : '')}>
            {check?.model ? '已验证调用' : check || account?.providerId ? '账号已接入' : account ? '已保存，待检测' : '尚未配置'}
          </span>
        </div>
        {(editing || !account) && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const id = selected || crypto.randomUUID();
                const s = await call('save', {
                  id,
                  name: name.trim() || `账号 ${accounts.length + 1}`,
                  ...(key ? { key } : {}),
                  workspace,
                });
                setAccounts(s.accounts);
                select(s.accounts.find((a: Account) => a.id === id));
                setMessage('密钥已保存，正在检测…');
                await verify(id);
              });
            }}
          >
            <label>
              API Key
              <input
                type="password"
                autoComplete="new-password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={account ? '留空保留已保存密钥' : '粘贴 API Key'}
                disabled={busy}
              />
            </label>
            <details>
              <summary>账号名称与控制台快捷入口（可选）</summary>
              <label>
                账号名称
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例如：个人账号"
                  disabled={busy}
                />
              </label>
              <label>
                控制台工作区地址
                <input
                  value={workspace}
                  onChange={(e) => setWorkspace(e.target.value)}
                  placeholder="无需填写即可接入"
                  disabled={busy}
                />
              </label>
            </details>
            <div className="opencode-row">
              <button disabled={busy || (!key && !account)} className="primary">
                保存并检测
              </button>
              {account && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const s = await call('remove', { id: selected });
                      setAccounts(s.accounts);
                      setSelected('');
                      setKey('');
                      setCheck(null);
                      setUsage(null);
                      setEditing(true);
                      setMessage('已移除；绑定此密钥的基座将停止调用');
                    })
                  }
                >
                  <Trash2 size={15} /> 移除此密钥
                </button>
              )}
            </div>
          </form>
        )}
        <p className="opencode-hint">
          保存后即可在智能体的 OpenCode 菜单选择模型；无需逐个接入基座。“检测所选模型”会发送简短请求，可能使用少量额度。
        </p>
      </div>
      <div className="opencode-card opencode-models">
        <div className="opencode-row">
          <h3>模型</h3>
          <div className="opencode-segments" aria-label="使用方式">
            <button disabled={busy} aria-pressed={tier === 'go'} onClick={() => setTier('go')}>
              Go 套餐
            </button>
            <button disabled={busy} aria-pressed={tier === 'zen'} onClick={() => setTier('zen')}>
              免费与按量
            </button>
          </div>
          <button
            title="刷新模型"
            aria-label="刷新模型"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const next = await call('models', { tier, refresh: true }) as Model[];
                setModels(next);
                setModel(previous => next.some(m => m.id === previous && m.available) ? previous : '');
                setCheck(null);
              })
            }
          >
            <RefreshCw size={16} />
          </button>
        </div>
        <p className="opencode-hint">
          {tier === 'go'
            ? '使用 Go 目录，不自动切换到按量计费。'
            : 'Zen 目录包含免费与按量模型，实际计费与账号权限以官方为准。'}
        </p>
        <label className="opencode-search">
          <Search size={17} />
          <input
            aria-label="查找模型"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索模型名称"
          />
        </label>
        <div className="opencode-model-list" role="radiogroup" aria-label="模型">
          {models
            .filter((m) => m.id.toLowerCase().includes(query.toLowerCase()))
            .map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={model === m.id}
                disabled={busy || !m.available}
                className={model === m.id ? 'selected' : ''}
                onClick={() => {
                  setModel(m.id);
                  setCheck(null);
                }}
              >
                <span>
                  {m.id}
                  <small>{check?.model === m.id ? '已验证调用' : m.available ? '目录已列出 · 调用权限待验证' : '协议待适配'}</small>
                </span>
                {model === m.id && <Check size={17} />}
              </button>
            ))}
          {!models.some((m) => m.id.toLowerCase().includes(query.toLowerCase())) && (
            <p>没有匹配的模型</p>
          )}
        </div>
        <div className="opencode-row">
          <button
            disabled={busy || !model || !account}
            className="primary"
            onClick={() =>
              void run(async () => {
                const connected=await call('connect', { id: selected, reference:`${selected}/${tier}/${model}`, setDefault:true });
                setAccounts(previous=>previous.map(a=>a.id===selected?{...a,providerId:connected.id}:a));
                setMessage(`已接入账号，默认模型已设为 ${model}；已有会话保持原模型`);
              })
            }
          >
            设为默认模型
          </button>
          <button
            disabled={busy || !model || !account}
            onClick={() => void run(() => verify(selected, true))}
          >
            检测所选模型
          </button>
        </div>
      </div>
      <div className="opencode-card opencode-usage">
        <div className="opencode-row">
          <h3>{tier === 'go' ? 'Go 用量' : '按量计费'}</h3>
          {tier === 'go' && (
            <button
              disabled={busy || !account}
              onClick={() => void run(async () => setUsage(await call('usage', { id: selected })))}
            >
              刷新用量
            </button>
          )}
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await call('open', { page: 'go', id: selected || 'default' });
              })
            }
          >
            <ExternalLink size={15} /> 官方控制台
          </button>
        </div>
        {tier === 'go' && usage ? (
          <>
            <p>{usage.message}</p>
            {usage.windows.map((w: any) => (
              <div key={w.label} className="opencode-window">
                <span>{w.label}</span>
                <progress
                  aria-label={w.label + '用量'}
                  max={100}
                  value={Math.max(0, Math.min(100, w.usedPercent))}
                />
                <span>已用 {w.usedPercent.toFixed(1)}%</span>
                {w.resetAt && <small>重置：{new Date(w.resetAt).toLocaleString()}</small>}
              </div>
            ))}
            <small>
              查询于 {new Date(usage.checkedAt).toLocaleString()}
              {usage.useBalance === true ? ' · 官方已开启超额使用余额' : ''}
            </small>
          </>
        ) : (
          <p>
            {tier === 'go'
              ? '检测连接后自动读取官方用量，也可单独刷新。'
              : '现金余额请在官方控制台查看；扩展不会更改计费设置。'}
          </p>
        )}
      </div>
      <div className="opencode-feedback" aria-live="polite">
        {busy && <p role="status">正在处理…</p>}
        {message && <p role="status">{message}</p>}
        {error && <p role="alert">{error}</p>}
      </div>
    </section>
  );
}
