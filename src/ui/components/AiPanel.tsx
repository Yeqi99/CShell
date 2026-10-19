import { usePermissionNavigation } from '../permission-navigation';
import {AiExtensionModelSelect} from './AiExtensionModelSelect';
import { AiPermissionTree } from './AiPermissionTree';
import { AiGoals } from './AiWork';
import { AiEventSubscriptions } from './AiEventSubscriptions';
import type { AiEventSnapshot } from '../../shared/ai-events';
import { Target } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  Plus,
  History,
  Settings2,
  MessageSquare,
  X,
  Trash2,
  Cpu,
  ShieldCheck,
  Radio,
} from 'lucide-react';
import {
  emptyAiPolicy,
  type AiSnapshot,
  type AiLocation,
  type AiMode,
  type AiProvider,
} from '../../shared/ai';
import { AiConversation } from './AiConversation';
import './ai-panel.css';
import type { Profile } from '../../shared/contracts';
const locations = { workspace: '工作台', terminal: '终端', files: '文件', python: 'Python' };
export function AiPanel({
  visible,
  sessionId,
  profiles,
  groups,
  onClose,
  executionVisible,
  onExecutionVisible,
}: {
  visible: boolean;
  sessionId?: string;
  profiles: Profile[];
  groups: string[];
  onClose: () => void;
  executionVisible: boolean;
  onExecutionVisible: (visible: boolean) => Promise<void>;
}) {
  const [snapshot, setSnapshot] = useState<AiSnapshot>({
    providers: [],
    permissions: [],
    policy: emptyAiPolicy(),
    extractionProviderId: null,
    threads: [],
  });
  const [page, setPage] = useState<'chat' | 'settings' | 'history' | 'goals' | 'events'>('chat');
  const [events, setEvents] = useState<
    AiEventSnapshot & { subscriptions: { id: string; name: string; source: string }[] }
  >({ rules: [], sources: [], runs: [], subscriptions: [] });
  const refreshEvents = async () => setEvents(await window.cshell.aiEventsSnapshot());
  useEffect(() => {
    if (!visible || page !== 'events') return;
    let disposed = false;
    let pending = false;
    const poll = async () => {
      if (pending) return;
      pending = true;
      try {
        const next = await window.cshell.aiEventsSnapshot();
        if (!disposed) setEvents(next);
      } catch (e) {
        if (!disposed) setError(e instanceof Error ? e.message : String(e));
      } finally {
        pending = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 3000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [visible, page]);
  const [location] = useState<AiLocation>('terminal');
  const [providerId, setProviderId] = useState(''),
    [threadId, setThreadId] = useState('');
  const [mode, setMode] = useState<AiMode>('review');
  const [settingsTab, setSettingsTab] = useState<'models' | 'permissions' | 'execution'>('models');
  const permissionRequest = usePermissionNavigation();
  useEffect(() => {
    if (permissionRequest?.node.page === 'ai') {
      setPage('settings');
      setSettingsTab('permissions');
    }
  }, [permissionRequest]);
  const [historySearch, setHistorySearch] = useState('');
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Pick<AiProvider, 'id' | 'name' | 'url' | 'model' | 'extension' | 'runBudget'> | null>(
    null,
  );
  const [key, setKey] = useState(''),
    [keyChanged, setKeyChanged] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    setTestResult(null);
  }, [editing?.id, editing?.url, editing?.model, key]);
  useEffect(
    () =>
      window.cshell.onAiThread((next) => {
        setSnapshot((previous) => ({
          ...previous,
          threads: previous.threads.some((t) => t.id === next.id)
            ? previous.threads.map((t) => (t.id === next.id ? next : t))
            : [...previous.threads, next],
        }));
      }),
    [],
  );
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
    setProviderId(snapshot.providers[0]?.id ?? '');
  }, [location, snapshot.providers.map((p) => p.id).join(',')]);
  const thread = snapshot.threads.find((t) => t.id === threadId);
  const [insertion, setInsertion] = useState<{ id: string; text: string; threadId: string } | null>(
    null,
  );
  const insertQueue = useRef(Promise.resolve());
  const currentConversation = useRef({ threadId, providerId, mode, sessionId });
  currentConversation.current = { threadId, providerId, mode, sessionId };
  useEffect(() => {
    const handler = (event: Event) => {
      const text = (event as CustomEvent<string>).detail;
      setPage('chat');
      insertQueue.current = insertQueue.current
        .catch(() => {})
        .then(async () => {
          const current = currentConversation.current;
          let targetId = current.threadId;
          if (!targetId) {
            const next = await window.cshell.aiSnapshot();
            const provider =
              next.providers.find((p) => p.id === current.providerId) ?? next.providers[0];
            if (provider) {
              const created = await window.cshell.aiThreadCreate(
                'terminal',
                provider.id,
                current.mode,
                current.sessionId,
              );
              targetId = created.id;
              currentConversation.current.threadId = targetId;
              setSnapshot(await window.cshell.aiSnapshot());
              setThreadId(targetId);
            }
          }
          setInsertion({ id: crypto.randomUUID(), text, threadId: targetId || 'new:terminal' });
        })
        .catch((e) => setError(String(e)));
    };
    window.addEventListener('cshell:analyze-selection', handler);
    return () => window.removeEventListener('cshell:analyze-selection', handler);
  }, []);
  const create = async () => {
    const t = await window.cshell.aiThreadCreate(location, providerId, mode, sessionId);
    setThreadId(t.id);
    return t;
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
            hidden={!snapshot.providers.length}
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
            hidden={!snapshot.providers.length && !snapshot.threads.length}
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
          <button
            className="icon"
            title="目标管理"
            aria-label="目标管理"
            aria-pressed={page === 'goals'}
            onClick={() => setPage(page === 'goals' ? 'chat' : 'goals')}
          >
            <Target size={16} />
          </button>
          <button
            className="icon"
            title="事件订阅"
            aria-label="事件订阅"
            aria-pressed={page === 'events'}
            onClick={() => setPage(page === 'events' ? 'chat' : 'events')}
          >
            <Radio size={16} />
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
          executionVisible={executionVisible}
          openThread={(id) => {
            setThreadId(id);
            setPage('chat');
          }}
          insertion={insertion}
          snapshot={snapshot}
          thread={thread}
          location={location}
          providerId={providerId}
          mode={mode}
          sessionId={sessionId}
          busy={busy}
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
      <div hidden={page !== 'goals'} className="agent-goals-page">
        <AiGoals
          snapshot={snapshot}
          sessionId={sessionId}
          create={create}
          run={run}
          busy={busy}
          open={(id) => {
            setThreadId(id);
            setPage('chat');
          }}
        />
      </div>
      <div className="agent-events-page" hidden={page !== 'events'}>
        <AiEventSubscriptions
          {...events}
          threads={snapshot.threads.filter(t => !t.parentId && !t.goal && snapshot.providers.some(p => p.id === t.providerId))}
          onRefresh={refreshEvents}
          onStartSubscription={(input) => window.cshell.aiEventListen(input)}
          onSave={async (rule) => {
            const saved = await window.cshell.aiEventSave(rule);
            await refreshEvents();
            return saved;
          }}
          onRemove={async (id) => {
            await window.cshell.aiEventRemove(id);
            await refreshEvents();
          }}
          onOpenThread={(id) => {
            setThreadId(id);
            setPage('chat');
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
      <div className="ai-settings" hidden={page !== 'settings'}>
        <nav className="agent-settings-tabs" aria-label="智能体设置分类">
          <button
            aria-pressed={settingsTab === 'execution'}
            onClick={() => setSettingsTab('execution')}
          >
            执行过程
          </button>
          <button aria-pressed={settingsTab === 'models'} onClick={() => setSettingsTab('models')}>
            <Cpu size={14} />
            模型基座
          </button>
          <button
            aria-pressed={settingsTab === 'permissions'}
            hidden={!snapshot.providers.length}
            onClick={() => setSettingsTab('permissions')}
          >
            <ShieldCheck size={14} />
            访问权限
          </button>
        </nav>
        <div hidden={settingsTab !== 'execution'}>
          <h3>指令过程显示</h3>
          <label className="permission-model">
            显示方式
            <select
              value={executionVisible ? 'visible' : 'silent'}
              disabled={busy}
              onChange={(e) => void run(() => onExecutionVisible(e.target.value === 'visible'))}
            >
              <option value="visible">可见：显示命令和实时返回内容</option>
              <option value="silent">静默：仅显示回复与授权提示</option>
            </select>
          </label>
          <p className="ai-section-note">
            可见模式在对应机器的左侧工作区显示实际执行过程。设置会自动保存。
          </p>
        </div>
        <div hidden={settingsTab !== 'models'}>
          <div className="ai-section-heading">
            <h3>API 基座</h3>
            <span>{snapshot.providers.length} 个</span>
          </div>
          <p className="ai-section-note">管理对话模型与连接信息解析模型。</p>
          <div hidden={!snapshot.providers.length}>
            <label className="permission-model">
              连接凭证解析模型
              <select
                aria-label="连接凭证解析模型"
                value={snapshot.extractionProviderId ?? ''}
                disabled={busy}
                onChange={(e) =>
                  void run(() => window.cshell.aiExtractionProviderSave(e.target.value || null))
                }
              >
                <option value="">自动选择可用基座</option>
                {snapshot.providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.model}
                  </option>
                ))}
              </select>
            </label>
            <p className="ai-section-note">用于从文本填写连接表单，与对话使用的模型独立。</p>
            {(['translate', 'compose'] as const).map((kind) => (
              <label className="permission-model" key={kind}>
                {kind === 'translate' ? '默认翻译 AI' : '“我想……”输入助手 AI'}
                <select
                  aria-label={kind === 'translate' ? '默认翻译 AI' : '输入助手 AI'}
                  value={snapshot.textProviderIds?.[kind] ?? ''}
                  disabled={busy}
                  onChange={(e) =>
                    void run(() => window.cshell.aiTextProviderSave(kind, e.target.value || null))
                  }
                >
                  <option value="">自动选择可用基座</option>
                  {snapshot.providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {p.model}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
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
                disabled={testing || busy}
                onClick={() => {
                  setEditing(p);
                  setKey('');
                  setKeyChanged(false);
                  setConfirmDelete(null);
                }}
              >
                <strong>{p.name}</strong>
                <small>
                  {p.model} · {p.extension ? '由扩展提供' : p.hasKey ? '已保存 Key' : '无 Key'}
                </small>
              </button>
              <button
                className="icon"
                title="删除基座"
                disabled={testing || busy}
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
            disabled={testing || busy}
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
                      ...(editing.runBudget?{runBudget:editing.runBudget}:{}),
                      ...(editing.extension?{extension:editing.extension}:{}),
                    },
                    keyChanged ? key : undefined,
                  );
                  setEditing(null);
                  setKey('');
                });
              }}
            >
              <fieldset disabled={busy || testing} className="ai-provider-fields">
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
                {editing.extension ? <AiExtensionModelSelect extension={editing.extension} onChange={(ref,model)=>setEditing({...editing,model,extension:{...editing.extension!,model:ref}})}/> : <>
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
                </>}
                <details><summary>持续执行预算</summary><small>按时间、累计上下文字节和重复无进展停止；字节预算不是计费金额。</small>{(['minutes','contextBytes','noProgress'] as const).map((field,i)=><label key={field}>{['每轮最多分钟','累计上下文预算（字节）','相同结果停止次数'][i]}<input type="number" min={[1,10000,2][i]} max={[240,20000000,20][i]} value={(editing.runBudget??{minutes:30,contextBytes:2000000,noProgress:5})[field]} onChange={e=>setEditing({...editing,runBudget:{minutes:30,contextBytes:2000000,noProgress:5,...editing.runBudget,[field]:Number(e.target.value)}})}/></label>)}</details>
                <div className="ai-form-actions">
                  <button
                    type="button"
                    className="secondary"
                    onClick={async (event) => {
                      if (!event.currentTarget.form?.reportValidity()) return;
                      setTesting(true);
                      setTestResult(null);
                      try {
                        const { id, name, url, model } = editing;
                        const result = await window.cshell.aiProviderTest(
                          { id, name, url, model, ...(editing.extension?{extension:editing.extension}:{}) },
                          keyChanged ? key : undefined,
                        );
                        setTestResult({
                          ok: true,
                          text: `连接成功 · ${result.elapsedMs} ms · ${result.streaming ? '支持流式回复' : '接口返回完整回复'}`,
                        });
                      } catch (e) {
                        setTestResult({
                          ok: false,
                          text: (e as Error).message.replace(
                            /^Error invoking remote method '[^']+': Error: /,
                            '',
                          ),
                        });
                      } finally {
                        setTesting(false);
                      }
                    }}
                  >
                    测试连通性
                  </button>
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
              </fieldset>
              {testing && (
                <p className="ai-provider-test" role="status">
                  正在测试模型回复…
                </p>
              )}
              {testResult && (
                <p
                  className={`ai-provider-test ${testResult.ok ? '' : 'danger'}`}
                  role={testResult.ok ? 'status' : 'alert'}
                >
                  {testResult.text}
                </p>
              )}
            </form>
          )}
        </div>
        <div hidden={settingsTab !== 'permissions'}>
          <AiPermissionTree
            visible={visible && page === 'settings' && settingsTab === 'permissions'}
            snapshot={snapshot}
            profiles={profiles}
            groups={groups}
            refresh={refresh}
          />
        </div>
      </div>
    </aside>
  );
}
