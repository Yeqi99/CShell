import { useEffect, useState } from 'react';
import { Plus, History, Settings2, MessageSquare, X, Trash2, Cpu, ShieldCheck } from 'lucide-react';
import {
  aiLocations,
  aiCapabilities,
  type AiSnapshot,
  type AiLocation,
  type AiMode,
  type AiPermission,
  type AiProvider,
} from '../../shared/ai';
import { AiConversation } from './AiConversation';
import './ai-panel.css';
import type { Profile } from '../../shared/contracts';
const locations = { workspace: '工作台', terminal: '终端', files: '文件', python: 'Python' };
const capabilities = {
  'metrics.read': '读取资源指标',
  'files.read': '读取远端文件',
  'commands.execute': '执行命令（可修改服务器）',
};
export function AiPanel({
  visible,
  sessionId,
  profiles,
  groups,
  onClose,
}: {
  visible: boolean;
  sessionId?: string;
  profiles: Profile[];
  groups: string[];
  onClose: () => void;
}) {
  const [snapshot, setSnapshot] = useState<AiSnapshot>({
    providers: [],
    permissions: [],
    threads: [],
  });
  const [page, setPage] = useState<'chat' | 'settings' | 'history'>('chat');
  const [location, setLocation] = useState<AiLocation>('terminal');
  const [providerId, setProviderId] = useState(''),
    [threadId, setThreadId] = useState('');
  const [mode, setMode] = useState<AiMode>('review');
  const [settingsTab, setSettingsTab] = useState<'models' | 'permissions'>('models');
  const [historySearch, setHistorySearch] = useState('');
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Pick<AiProvider, 'id' | 'name' | 'url' | 'model'> | null>(
    null,
  );
  const [key, setKey] = useState(''),
    [keyChanged, setKeyChanged] = useState(false);
  const [permission, setPermission] = useState<AiPermission | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const refresh = async () => setSnapshot(await window.cshell.aiSnapshot());
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!visible) return;
    let disposed = false;
    const poll = async () => {
      try {
        const next = await window.cshell.aiSnapshot();
        if (!disposed) setSnapshot(next);
      } catch (e) {
        if (!disposed) setError((e as Error).message);
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 800);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [visible]);
  useEffect(() => {
    setProviderId(
      snapshot.permissions.find((p) => p.location === location)?.providerId ??
        snapshot.providers[0]?.id ??
        '',
    );
  }, [
    location,
    snapshot.permissions.map((p) => p.providerId).join(','),
    snapshot.providers.map((p) => p.id).join(','),
  ]);
  const thread = snapshot.threads.find((t) => t.id === threadId);
  const create = async () => {
    const t = await window.cshell.aiThreadCreate(location, providerId, mode, sessionId);
    setThreadId(t.id);
    return t;
  };
  const changeLocation = (next: AiLocation) => {
    setLocation(next);
    setPermission(null);
  };
  return (
    <aside className="ai-panel" hidden={!visible} aria-label="AI 智能体">
      <header>
        <strong className="agent-title">
          <MessageSquare size={17} />
          智能体
        </strong>
        <div className="ai-toolbar">
          <button
            className="icon"
            title="新建会话"
            aria-label="新建 AI 会话"
            onClick={() => {
              setThreadId('');
              setPage('chat');
              setConfirmDelete(null);
            }}
          >
            <Plus size={16} />
          </button>
          <button
            className="icon"
            title="会话记录"
            aria-label="会话记录"
            aria-pressed={page === 'history'}
            onClick={() => setPage(page === 'history' ? 'chat' : 'history')}
          >
            <History size={16} />
          </button>
          <button
            className="icon"
            title="基座与权限"
            aria-label="基座与权限"
            aria-pressed={page === 'settings'}
            onClick={() => setPage(page === 'settings' ? 'chat' : 'settings')}
          >
            <Settings2 size={16} />
          </button>
          <button className="icon" title="折叠智能体" aria-label="折叠智能体" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
      </header>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="agent-chat-page" hidden={page !== 'chat'}>
        <AiConversation
          snapshot={snapshot}
          thread={thread}
          location={location}
          providerId={providerId}
          mode={mode}
          sessionId={sessionId}
          busy={busy}
          changeLocation={changeLocation}
          setProviderId={setProviderId}
          setMode={setMode}
          create={create}
          run={run}
          configure={() => {
            setPage('settings');
            setSettingsTab('models');
          }}
        />
      </div>
      {page === 'history' && (
        <div className="agent-history">
          <div className="ai-section-heading">
            <h3>会话记录</h3>
            <span>{snapshot.threads.length} 条</span>
          </div>
          <input
            type="search"
            aria-label="搜索会话"
            placeholder="搜索会话…"
            value={historySearch}
            onChange={(e) => setHistorySearch(e.target.value)}
          />
          {!snapshot.threads.length && (
            <p className="ai-section-note">开始对话后，记录会保存在这里。</p>
          )}
          {snapshot.threads
            .filter((t) => t.title.toLowerCase().includes(historySearch.toLowerCase()))
            .map((t) => (
              <div className="agent-history-row" key={t.id}>
                <button
                  onClick={() => {
                    setThreadId(t.id);
                    setPage('chat');
                    setConfirmDelete(null);
                  }}
                >
                  <strong>{t.title}</strong>
                  <small>
                    {locations[t.location]} · {t.target ?? '仅对话'}
                    {t.state === 'running'
                      ? ' · 正在执行'
                      : t.state === 'approval'
                        ? ' · 等待审核'
                        : ''}
                  </small>
                </button>
                <button
                  className="icon"
                  title="删除会话记录"
                  aria-label={`删除会话 ${t.title}`}
                  disabled={busy || t.state === 'running' || t.state === 'approval'}
                  onClick={() => setConfirmDelete(t.id)}
                >
                  <Trash2 size={14} />
                </button>
                {confirmDelete === t.id && (
                  <div className="ai-confirm">
                    删除这段本地记录？
                    <button
                      onClick={() =>
                        void run(async () => {
                          await window.cshell.aiThreadDelete(t.id);
                          if (threadId === t.id) setThreadId('');
                          setConfirmDelete(null);
                        })
                      }
                    >
                      删除
                    </button>
                    <button onClick={() => setConfirmDelete(null)}>保留</button>
                  </div>
                )}
              </div>
            ))}
        </div>
      )}
      {page === 'settings' && (
        <div className="ai-settings">
          <nav className="agent-settings-tabs" aria-label="智能体设置分类">
            <button
              aria-pressed={settingsTab === 'models'}
              onClick={() => setSettingsTab('models')}
            >
              <Cpu size={14} />
              模型基座
            </button>
            <button
              aria-pressed={settingsTab === 'permissions'}
              onClick={() => setSettingsTab('permissions')}
            >
              <ShieldCheck size={14} />
              访问权限
            </button>
          </nav>
          <div hidden={settingsTab !== 'models'}>
            <div className="ai-section-heading">
              <h3>API 基座</h3>
              <span>{snapshot.providers.length} 个</span>
            </div>
            <p className="ai-section-note">连接模型，为各个工作位置选择默认基座。</p>
            {!snapshot.providers.length && !editing && (
              <div className="ai-provider-empty">
                <Settings2 size={18} />
                <span>
                  尚未添加基座<small>支持 OpenAI 兼容接口与本机模型</small>
                </span>
              </div>
            )}
            {snapshot.providers.map((p) => (
              <div className="ai-provider" key={p.id}>
                <button
                  onClick={() => {
                    setEditing(p);
                    setKey('');
                    setKeyChanged(false);
                    setConfirmDelete(null);
                  }}
                >
                  <strong>{p.name}</strong>
                  <small>
                    {p.model} · {p.hasKey ? '已保存 Key' : '无 Key'}
                  </small>
                </button>
                <button
                  className="icon"
                  title="删除基座"
                  aria-label={`删除基座 ${p.name}`}
                  onClick={() => setConfirmDelete(p.id)}
                >
                  <Trash2 size={14} />
                </button>
                {confirmDelete === p.id && (
                  <div>
                    删除该基座？
                    <button
                      onClick={() =>
                        void run(async () => {
                          await window.cshell.aiProviderDelete(p.id);
                          setConfirmDelete(null);
                          setEditing(null);
                        })
                      }
                    >
                      删除
                    </button>
                    <button onClick={() => setConfirmDelete(null)}>保留</button>
                  </div>
                )}
              </div>
            ))}
            <button
              className="ai-add-provider"
              onClick={() => {
                setEditing({ id: crypto.randomUUID(), name: '', url: '', model: '' });
                setKey('');
                setKeyChanged(true);
              }}
            >
              <Plus size={14} />
              添加基座
            </button>
            {editing && (
              <form
                className="ai-provider-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    await window.cshell.aiProviderSave(
                      {
                        id: editing.id,
                        name: editing.name,
                        url: editing.url,
                        model: editing.model,
                      },
                      keyChanged ? key : undefined,
                    );
                    setEditing(null);
                    setKey('');
                  });
                }}
              >
                <div className="ai-form-heading">
                  <strong>
                    {snapshot.providers.some((p) => p.id === editing.id) ? '编辑基座' : '新基座'}
                  </strong>
                  <small>密钥在本机加密保存</small>
                </div>
                <label>
                  名称
                  <input
                    required
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  />
                </label>
                <label>
                  API URL
                  <input
                    required
                    type="url"
                    aria-label="API URL"
                    value={editing.url}
                    placeholder="https://api.example.com/v1"
                    onChange={(e) => setEditing({ ...editing, url: e.target.value })}
                  />
                  <small>填写 /v1 或完整 /chat/completions 地址</small>
                </label>
                <label>
                  模型 ID
                  <input
                    required
                    value={editing.model}
                    onChange={(e) => setEditing({ ...editing, model: e.target.value })}
                  />
                </label>
                <label>
                  API Key
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={key}
                    placeholder={keyChanged ? '可留空（本机模型）' : '留空保留原 Key'}
                    onChange={(e) => {
                      setKeyChanged(true);
                      setKey(e.target.value);
                    }}
                  />
                </label>
                <div className="ai-form-actions">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      setEditing(null);
                      setKey('');
                    }}
                  >
                    取消
                  </button>
                  <button className="primary" disabled={busy}>
                    保存基座
                  </button>
                </div>
              </form>
            )}
          </div>
          <div hidden={settingsTab !== 'permissions'}>
            <div className="ai-section-heading ai-permission-heading">
              <h3>位置与权限</h3>
              <ShieldCheck size={15} />
            </div>
            <p className="ai-section-note">按使用位置设置模型和可访问的机器、工具。</p>
            <div className="ai-permission-toolbar">
              <select
                aria-label="权限位置"
                value={location}
                onChange={(e) => changeLocation(e.target.value as AiLocation)}
              >
                {aiLocations.map((l) => (
                  <option key={l} value={l}>
                    {locations[l]}
                  </option>
                ))}
              </select>
              <button
                className="icon"
                title="编辑该位置权限"
                aria-label="编辑该位置权限"
                onClick={() =>
                  setPermission(
                    snapshot.permissions.find((p) => p.location === location) ?? {
                      location,
                      providerId: null,
                      groups: [],
                      profiles: [],
                      capabilities: [],
                    },
                  )
                }
              >
                <Settings2 size={16} />
              </button>
            </div>
            {permission && (
              <form
                className="ai-permissions"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    await window.cshell.aiPermissionSave(permission);
                    setPermission(null);
                  });
                }}
              >
                <label>
                  默认基座
                  <select
                    value={permission.providerId ?? ''}
                    onChange={(e) =>
                      setPermission({ ...permission, providerId: e.target.value || null })
                    }
                  >
                    <option value="">手动选择</option>
                    {snapshot.providers.map((p) => (
                      <option value={p.id} key={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <fieldset>
                  <legend>工具能力</legend>
                  {aiCapabilities.map((c) => (
                    <label key={c}>
                      <input
                        type="checkbox"
                        checked={permission.capabilities.includes(c)}
                        onChange={(e) =>
                          setPermission({
                            ...permission,
                            capabilities: e.target.checked
                              ? [...permission.capabilities, c]
                              : permission.capabilities.filter((v) => v !== c),
                          })
                        }
                      />
                      {capabilities[c]}
                    </label>
                  ))}
                </fieldset>
                <fieldset>
                  <legend>分组范围（包含以后加入的机器）</legend>
                  {groups.map((g) => (
                    <label key={g}>
                      <input
                        type="checkbox"
                        checked={permission.groups.includes(g)}
                        onChange={(e) =>
                          setPermission({
                            ...permission,
                            groups: e.target.checked
                              ? [...permission.groups, g]
                              : permission.groups.filter((v) => v !== g),
                          })
                        }
                      />
                      {g}
                    </label>
                  ))}
                </fieldset>
                <fieldset>
                  <legend>单独授权机器</legend>
                  {profiles.map((p) => (
                    <label key={p.id}>
                      <input
                        type="checkbox"
                        checked={permission.profiles.includes(p.id)}
                        onChange={(e) =>
                          setPermission({
                            ...permission,
                            profiles: e.target.checked
                              ? [...permission.profiles, p.id]
                              : permission.profiles.filter((v) => v !== p.id),
                          })
                        }
                      />
                      {p.name} · {p.host}
                    </label>
                  ))}
                </fieldset>
                <p className="muted">
                  工具结果会发送到所选基座。未勾选的机器与功能不可调用，全放行也不扩大范围。临时连接需先保存为服务器才能授权。
                </p>
                <button className="primary" disabled={busy}>
                  保存权限
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
