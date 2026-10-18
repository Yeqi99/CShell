import { ConnectionExtractor } from './ConnectionExtractor';
import { useEffect, useRef, useState } from 'react';
import { Plus, Send, Square, Save, Trash2, Settings2, RefreshCw, Copy, Globe } from 'lucide-react';
import {
  httpToolNames,
  httpToolLabels,
  newHttpRequest,
  type HttpWorkspace,
  type HttpRequest,
  type HttpHistory,
  type HttpSender,
} from '../../shared/http';
import type { Profile } from '../../shared/contracts';
import './http-workbench.css';

export function HttpCreate({
  onCreated,
  groups,
}: {
  onCreated: (id: string) => Promise<void>;
  groups: string[];
}) {
  const [initialUrl,setInitialUrl]=useState(''),[extracting,setExtracting]=useState(false),[createdId,setCreatedId]=useState<string>();
  const [name, setName] = useState('HTTP 请求'),
    [group, setGroup] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="http-create"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        void (async()=>{
            const id=createdId??await window.cshell.httpCreate(name,group);setCreatedId(id);
            if(initialUrl){const w=await window.cshell.httpWorkspace(id);const target={id:crypto.randomUUID(),name:new URL(initialUrl).host,url:initialUrl};await window.cshell.httpSave({...w,targets:[target],requests:w.requests.map(r=>({...r,targetId:target.id}))});}
            await onCreated(id);
          })()
          .catch((e) => setError(e.message))
          .finally(() => setBusy(false));
      }}
    >
      <ConnectionExtractor title="HTTP 请求" titleId="http-create-title" providerId="cshell.http" disabled={busy} onStart={()=>setError('')} onBusy={setExtracting} onExtract={({fields})=>{if(fields.url)setInitialUrl(fields.url);if(fields.name)setName(fields.name);if(fields.group)setGroup(fields.group);}}/>
      <label>目标地址<input type="url" placeholder="https://example.com" value={initialUrl} onChange={e=>setInitialUrl(e.target.value)}/></label>
      <label>
        工作区名称
        <input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        分组
        <input
          list="http-groups"
          value={group}
          maxLength={100}
          onChange={(e) => setGroup(e.target.value)}
        />
        <datalist id="http-groups">
          {groups.map((g) => (
            <option key={g}>{g}</option>
          ))}
        </datalist>
      </label>
      <p>保存多个目标地址、常用请求和执行历史。发送时选择本机或已连接的发送方。</p>
      <button className="primary" disabled={busy||extracting}>
        {busy ? '正在创建…' : '创建 HTTP 工作区'}
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
function Pairs({
  rows,
  onChange,
  label,
}: {
  rows: HttpRequest['headers'];
  onChange: (rows: HttpRequest['headers']) => void;
  label: string;
}) {
  return (
    <div className="http-pairs">
      <div className="http-section-heading">
        <strong>{label}</strong>
        <button
          className="icon"
          title={'添加' + label}
          aria-label={'添加' + label}
          onClick={() => onChange([...rows, { enabled: true, name: '', value: '' }])}
        >
          <Plus size={15} />
        </button>
      </div>
      {rows.map((row, i) => (
        <div className="http-pair" key={i}>
          <input
            type="checkbox"
            aria-label={`启用${label} ${i + 1}`}
            checked={row.enabled}
            onChange={(e) =>
              onChange(rows.map((r, j) => (i === j ? { ...r, enabled: e.target.checked } : r)))
            }
          />
          <input
            aria-label={`${label}名称 ${i + 1}`}
            placeholder="名称"
            value={row.name}
            onChange={(e) =>
              onChange(rows.map((r, j) => (i === j ? { ...r, name: e.target.value } : r)))
            }
          />
          <input
            aria-label={`${label}值 ${i + 1}`}
            placeholder="值"
            type={/authorization|cookie|token|api[-_]?key/i.test(row.name) ? 'password' : 'text'}
            value={row.value}
            onChange={(e) =>
              onChange(rows.map((r, j) => (i === j ? { ...r, value: e.target.value } : r)))
            }
          />
          <button
            className="icon"
            title="移除此行"
            aria-label={`移除${label} ${i + 1}`}
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      {!rows.length && <p className="muted">尚未添加{label}</p>}
    </div>
  );
}
export function HttpWorkbench({
  profile,
  enabled,
  onSaveProfile,
}: {
  profile: Profile;
  enabled: boolean;
  onSaveProfile: (p: Profile) => Promise<void>;
}) {
  const [workspace, setWorkspace] = useState<HttpWorkspace>(),
    [senders, setSenders] = useState<HttpSender[]>([]),
    [history, setHistory] = useState<HttpHistory[]>([]);
  const [drafts, setDrafts] = useState<Record<string, HttpRequest>>({}),
    [selected, setSelected] = useState(''),
    [response, setResponse] = useState<HttpHistory>();
  const [runs, setRuns] = useState<Record<string, string>>({}),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState(false),
    [panel, setPanel] = useState<'query' | 'headers' | 'body'>('query'),
    [responsePanel, setResponsePanel] = useState<'body' | 'headers'>('body');
  const [metadata, setMetadata] = useState({ name: profile.name, group: profile.group });
  const [configDraft, setConfigDraft] = useState<HttpWorkspace>();
  const mounted = useRef(true),
    busyRequests = useRef(new Set<string>());
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    setMetadata({ name: profile.name, group: profile.group });
  }, [profile.name, profile.group]);
  const refresh = async () => {
    const [w, s, h] = await Promise.all([
      window.cshell.httpWorkspace(profile.id),
      window.cshell.httpSenders(),
      window.cshell.httpHistory(profile.id),
    ]);
    if (!mounted.current) return;
    setWorkspace(w);
    setSenders(s);
    setHistory(h);
    setSelected((current) => {
      if (current) return current;
      const request = w.requests[0] ?? newHttpRequest();
      setDrafts((d) => ({ ...d, [request.id]: request }));
      return request.id;
    });
  };
  useEffect(() => {
    if (!enabled) return;
    void refresh().catch((e) => setError(e.message));
    const off = window.cshell.onHttpChanged((id) => {
      if (id === profile.id) void refresh().catch((e) => setError(e.message));
    });
    const timer = setInterval(
      () =>
        void window.cshell
          .httpSenders()
          .then(setSenders)
          .catch(() => {}),
      4000,
    );
    return () => {
      off();
      clearInterval(timer);
    };
  }, [profile.id, enabled]);
  const request = drafts[selected] ?? workspace?.requests.find((r) => r.id === selected);
  const change = (next: Partial<HttpRequest>) => {
    if (request) setDrafts((d) => ({ ...d, [selected]: { ...request, ...next } }));
    setNotice('');
  };
  const choose = (r: HttpRequest) => {
    setSelected(r.id);
    setResponse(undefined);
  };
  const run = async (fn: () => Promise<void>) => {
    setError('');
    try {
      await fn();
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    }
  };
  const saveRequest = async () => {
    if (!request || !workspace) return;
    setSaving(true);
    try {
      const next = await window.cshell.httpSave({
        ...workspace,
        requests: [...workspace.requests.filter((r) => r.id !== request.id), request],
      });
      setWorkspace(next);
      setDrafts((d) => {
        const copy = { ...d };
        delete copy[request.id];
        return copy;
      });
      setNotice('请求已保存');
    } finally {
      setSaving(false);
    }
  };
  const send = async () => {
    if (!request || busyRequests.current.has(request.id)) return;
    const captured = structuredClone(request),
      runId = crypto.randomUUID();
    busyRequests.current.add(captured.id);
    setRuns((r) => ({ ...r, [captured.id]: runId }));
    setError('');
    setNotice('正在发送…');
    try {
      const result = await window.cshell.httpSend(profile.id, captured, runId);
      if (mounted.current) {
        setResponse(result);
        setNotice(result.state === 'done' ? '请求完成' : (result.error ?? result.state));
        await refresh();
      }
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      busyRequests.current.delete(captured.id);
      if (mounted.current)
        setRuns((r) => {
          const next = { ...r };
          delete next[captured.id];
          return next;
        });
    }
  };
  if (!enabled)
    return (
      <div className="http-create">
        <h2>{profile.name}</h2>
        <p>HTTP 扩展已停用。请求与历史仍保留，启用后可继续使用。</p>
        <button onClick={() => window.dispatchEvent(new Event('cshell:open-extensions'))}>
          打开插件市场
        </button>
      </div>
    );
  const allRequests = [
    ...(workspace?.requests ?? []).map((r) => drafts[r.id] ?? r),
    ...Object.values(drafts).filter((r) => !workspace?.requests.some((s) => s.id === r.id)),
  ];
  let body = '';
  try {
    body = response?.response
      ? new TextDecoder().decode(
          Uint8Array.from(atob(response.response.body), (c) => c.charCodeAt(0)),
        )
      : '';
  } catch {
    body = '无法解码响应';
  }
  let formatted = body;
  try {
    formatted = JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    /* Preserve raw response. */
  }
  const contentType =
    response?.response?.headers
      .find(([k]) => k.toLowerCase() === 'content-type')?.[1]
      ?.split(';')[0] ?? '';
  return (
    <section className="http-workbench" aria-label="HTTP 工作区">
      <header className="http-heading">
        <Globe size={18} />
        <strong>{profile.name}</strong>
        <span className="muted">HTTP</span>
        <button
          className="icon"
          title="刷新请求和发送方"
          aria-label="刷新请求和发送方"
          onClick={() => void run(refresh)}
        >
          <RefreshCw size={15} />
        </button>
        <button
          className="icon"
          title="目标与智能体工具"
          aria-label="目标与智能体工具"
          onClick={() => {
            setSettings(!settings);
            if (!settings) setConfigDraft(workspace ? structuredClone(workspace) : undefined);
          }}
        >
          <Settings2 size={16} />
        </button>
      </header>
      <div className="http-layout">
        <aside className="http-collections">
          <div className="http-section-heading">
            <strong>请求</strong>
            <button
              className="icon"
              title="新建请求"
              aria-label="新建请求"
              onClick={() => {
                const r = newHttpRequest();
                setDrafts((d) => ({ ...d, [r.id]: r }));
                choose(r);
              }}
            >
              <Plus size={16} />
            </button>
          </div>
          {allRequests.map((r) => (
            <button
              className={selected === r.id ? 'selected' : ''}
              key={r.id}
              onClick={() => choose(r)}
            >
              <small>{r.method}</small>
              <span>
                {r.name}
                {drafts[r.id] ? ' ·' : ''}
              </span>
            </button>
          ))}
          <div className="http-section-heading">
            <strong>历史</strong>
            <small>最近 50 条</small>
          </div>
          {history.map((h) => (
            <button
              key={h.id}
              onClick={() => {
                setResponse(h);
              }}
              title={`${h.url}\n${h.senderLabel}`}
            >
              <small>{h.response?.status ?? (h.state === 'running' ? '…' : '×')}</small>
              <span>
                {h.request.name}
                <small>
                  {new Date(h.time).toLocaleTimeString()} ·{' '}
                  {h.source === 'agent' ? '智能体' : '手动'}
                </small>
              </span>
            </button>
          ))}
        </aside>
        <div className="http-main">
          {settings && configDraft ? (
            <div className="http-settings">
              <h2>工作区设置</h2>
              <div className="http-row">
                <label>
                  名称
                  <input
                    value={metadata.name}
                    onChange={(e) => setMetadata({ ...metadata, name: e.target.value })}
                  />
                </label>
                <label>
                  分组
                  <input
                    value={metadata.group}
                    onChange={(e) => setMetadata({ ...metadata, group: e.target.value })}
                  />
                </label>
              </div>
              <div className="http-section-heading">
                <h3>目标地址</h3>
                <button
                  onClick={() =>
                    setConfigDraft({
                      ...configDraft,
                      targets: [
                        ...configDraft.targets,
                        { id: crypto.randomUUID(), name: '新目标', url: '' },
                      ],
                    })
                  }
                >
                  <Plus size={14} />
                  添加目标
                </button>
              </div>
              {configDraft.targets.map((target, i) => (
                <div className="http-row" key={target.id}>
                  <input
                    aria-label={`目标名称 ${i + 1}`}
                    value={target.name}
                    onChange={(e) =>
                      setConfigDraft({
                        ...configDraft,
                        targets: configDraft.targets.map((t) =>
                          t.id === target.id ? { ...t, name: e.target.value } : t,
                        ),
                      })
                    }
                  />
                  <input
                    aria-label={`目标地址 ${i + 1}`}
                    placeholder="https://api.example.com/"
                    value={target.url}
                    onChange={(e) =>
                      setConfigDraft({
                        ...configDraft,
                        targets: configDraft.targets.map((t) =>
                          t.id === target.id ? { ...t, url: e.target.value } : t,
                        ),
                      })
                    }
                  />
                  <button
                    className="icon"
                    aria-label={`移除目标 ${i + 1}`}
                    title="移除目标"
                    onClick={() =>
                      setConfigDraft({
                        ...configDraft,
                        targets: configDraft.targets.filter((t) => t.id !== target.id),
                      })
                    }
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
              <h3>智能体工具</h3>
              <p className="muted">
                默认加入工具列表。实际调用仍需在智能体权限中授权此工作区和发送方。
              </p>
              {httpToolNames.map((tool) => (
                <label className="http-tool" key={tool}>
                  <input
                    type="checkbox"
                    checked={configDraft.tools.includes(tool)}
                    onChange={(e) =>
                      setConfigDraft({
                        ...configDraft,
                        tools: e.target.checked
                          ? [...configDraft.tools, tool]
                          : configDraft.tools.filter((t) => t !== tool),
                      })
                    }
                  />
                  {httpToolLabels[tool]}
                </label>
              ))}
              <button
                className="primary"
                disabled={saving}
                onClick={() =>
                  void run(async () => {
                    setSaving(true);
                    try {
                      const w = await window.cshell.httpSave(configDraft);
                      setWorkspace(w);
                      setConfigDraft(w);
                      await onSaveProfile({ ...profile, ...metadata });
                      setNotice('设置已保存');
                      setSettings(false);
                    } finally {
                      setSaving(false);
                    }
                  })
                }
              >
                保存设置
              </button>
            </div>
          ) : (
            request && (
              <>
                <div className="http-request-name">
                  <input
                    aria-label="请求名称"
                    value={request.name}
                    onChange={(e) => change({ name: e.target.value })}
                  />
                  <button disabled={saving} onClick={() => void run(saveRequest)}>
                    <Save size={14} />
                    保存请求
                  </button>
                </div>
                <div className="http-row http-destinations">
                  <label>
                    目标
                    <select
                      aria-label="HTTP 目标"
                      value={request.targetId ?? ''}
                      onChange={(e) => change({ targetId: e.target.value || undefined })}
                    >
                      <option value="">完整 URL</option>
                      {workspace?.targets.map((t) => (
                        <option value={t.id} key={t.id}>
                          {t.name} · {t.url}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    发送方
                    <select
                      aria-label="HTTP 发送方"
                      value={request.sender}
                      onChange={(e) => change({ sender: e.target.value })}
                    >
                      {senders.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                          {s.reason ? ` · ${s.reason}` : ''}
                        </option>
                      ))}
                      {!senders.some((s) => s.id === request.sender) && (
                        <option value={request.sender} disabled>
                          发送方已移除
                        </option>
                      )}
                    </select>
                  </label>
                  {request.sender !== 'local' &&
                    !senders.find((s) => s.id === request.sender)?.available && (
                      <button
                        onClick={() =>
                          window.dispatchEvent(
                            new CustomEvent('cshell:open-sender', { detail: request.sender }),
                          )
                        }
                      >
                        连接发送方
                      </button>
                    )}
                </div>
                <div className="http-url">
                  <select
                    aria-label="请求方法"
                    value={request.method}
                    onChange={(e) => change({ method: e.target.value as HttpRequest['method'] })}
                  >
                    {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                  <input
                    aria-label="请求地址"
                    placeholder={request.targetId ? '/path' : 'https://example.com/path'}
                    value={request.path}
                    onChange={(e) => change({ path: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.ctrlKey && e.key === 'Enter') void send();
                    }}
                  />
                  {runs[selected] ? (
                    <button
                      onClick={() => void run(() => window.cshell.httpCancel(runs[selected]))}
                    >
                      <Square size={14} />
                      取消
                    </button>
                  ) : (
                    <button
                      className="primary"
                      onClick={() => void send()}
                      disabled={!senders.find((s) => s.id === request.sender)?.available}
                    >
                      <Send size={14} />
                      发送
                    </button>
                  )}
                </div>
                <div className="http-editor-tabs" role="tablist" aria-label="请求内容">
                  {(['query', 'headers', 'body'] as const).map((p, i) => (
                    <button
                      role="tab"
                      aria-selected={panel === p}
                      key={p}
                      onClick={() => setPanel(p)}
                    >
                      {['参数', '请求头', '请求体'][i]}
                    </button>
                  ))}
                  <label>
                    超时{' '}
                    <input
                      aria-label="HTTP 超时秒数"
                      type="number"
                      min={1}
                      max={60}
                      value={request.timeoutMs / 1000}
                      onChange={(e) => change({ timeoutMs: Number(e.target.value) * 1000 })}
                    />{' '}
                    秒
                  </label>
                </div>
                <div className="http-request-editor">
                  {panel === 'query' ? (
                    <Pairs
                      rows={request.query}
                      label="参数"
                      onChange={(query) => change({ query })}
                    />
                  ) : panel === 'headers' ? (
                    <Pairs
                      rows={request.headers}
                      label="请求头"
                      onChange={(headers) => change({ headers })}
                    />
                  ) : (
                    <>
                      <div className="http-row">
                        <select
                          aria-label="请求体类型"
                          value={request.bodyType}
                          onChange={(e) =>
                            change({ bodyType: e.target.value as HttpRequest['bodyType'] })
                          }
                        >
                          <option value="none">无请求体</option>
                          <option value="json">JSON</option>
                          <option value="text">文本</option>
                          <option value="form">URL 编码表单</option>
                        </select>
                        {request.bodyType === 'json' && (
                          <button
                            onClick={() =>
                              void run(async () =>
                                change({ body: JSON.stringify(JSON.parse(request.body), null, 2) }),
                              )
                            }
                          >
                            格式化 JSON
                          </button>
                        )}
                      </div>
                      {request.bodyType !== 'none' && (
                        <textarea
                          spellCheck={false}
                          aria-label="请求体"
                          value={request.body}
                          onChange={(e) => change({ body: e.target.value })}
                          placeholder={request.bodyType === 'form' ? 'name=value&other=value' : ''}
                        />
                      )}
                    </>
                  )}
                </div>
              </>
            )
          )}
          {error && (
            <p role="alert" className="http-error">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="http-notice">
              {notice}
            </p>
          )}
          {response && (
            <div className="http-response">
              <header>
                <strong>
                  响应 {response.response?.status} {response.response?.statusText}
                </strong>
                <span>
                  {response.senderLabel} · {response.response?.elapsedMs ?? 0} ms ·{' '}
                  {response.response?.bytes ?? 0} B{response.response?.truncated ? ' · 已截断' : ''}
                </span>
                <button
                  className="icon"
                  title="复制响应"
                  aria-label="复制响应"
                  onClick={() => void run(() => window.cshell.copyText(body))}
                >
                  <Copy size={14} />
                </button>
                <button
                  onClick={() => {
                    const r = {
                      ...response.request,
                      id: crypto.randomUUID(),
                      name: response.request.name + ' 副本',
                    };
                    setDrafts((d) => ({ ...d, [r.id]: r }));
                    setSelected(r.id);
                    setSettings(false);
                  }}
                >
                  载入为新请求
                </button>
                {response.state === 'running' && (
                  <button onClick={() => void run(() => window.cshell.httpCancel(response.id))}>
                    取消请求
                  </button>
                )}
              </header>
              <small>
                {response.request.method} {response.url}
              </small>
              {response.error && <p role="alert">{response.error}</p>}
              <div className="http-editor-tabs">
                <button
                  aria-pressed={responsePanel === 'body'}
                  onClick={() => setResponsePanel('body')}
                >
                  响应体
                </button>
                <button
                  aria-pressed={responsePanel === 'headers'}
                  onClick={() => setResponsePanel('headers')}
                >
                  响应头
                </button>
              </div>
              {responsePanel === 'headers' ? (
                <pre>{response.response?.headers.map(([k, v]) => `${k}: ${v}`).join('\n')}</pre>
              ) : /^(image\/(png|jpeg|gif|webp))$/.test(contentType) && response.response ? (
                <img
                  className="http-image"
                  alt="HTTP 响应图片"
                  src={`data:${contentType};base64,${response.response.body}`}
                />
              ) : (
                <pre>{formatted || (response.state === 'running' ? '正在接收…' : '无响应体')}</pre>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
