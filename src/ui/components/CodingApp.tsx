import { useEffect, useRef, useState } from 'react';
import {
  Menu,
  Plus,
  Settings,
  ArrowLeft,
  Send,
  Square,
  Code2,
  Folder,
  Globe,
  Check,
  Trash2,
  RefreshCw,
  Download,
  ShieldCheck,
} from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { AgentCall } from '../../shared/agent';
import type { CodingEngine, CodingProfile, CodingTask } from '../../shared/coding';
import './coding-app.css';
type Profile = Omit<CodingProfile, 'key'> & { hasKey: boolean };
type Status = {
  directory: string;
  engines: {
    engine: CodingEngine;
    path: string;
    ready: boolean;
    version?: string;
    reason?: string;
  }[];
  profiles: Profile[];
  installs: { id: string; state: string; output: string }[];
};
const states: Record<string, string> = {
  stopping: '停止中',
  running: '执行中',
  approval: '等待授权',
  completed: '已完成',
  failed: '失败',
  cancelled: '已停止',
  interrupted: '已中断',
};
export function CodingApp({
  engine,
  name,
  call,
  openBrowser,
  active,
}: {
  engine: CodingEngine;
  name: string;
  call: (method: AgentCall['method'], params?: unknown) => Promise<unknown>;
  openBrowser: (url: string) => Promise<void>;
  active: boolean;
}) {
  const [sideOpen, setSideOpen] = useState(false);
  const [status, setStatus] = useState<Status>(),
    [tasks, setTasks] = useState<CodingTask[]>([]),
    [selected, setSelected] = useState(''),
    [task, setTask] = useState<CodingTask>(),
    [profile, setProfile] = useState(''),
    [cwd, setCwd] = useState(''),
    [mode, setMode] = useState('read'),
    [drafts, setDrafts] = useState<Record<string, string>>({}),
    [panel, setPanel] = useState<'' | 'profiles' | 'runtime'>(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [edit, setEdit] = useState<CodingProfile>(),
    [runtime, setRuntime] = useState({ directory: '', codex: '', claude: '' }),
    [plan, setPlan] = useState<any>(),
    [login, setLogin] = useState<any>(),
    [code, setCode] = useState('');
  const scroll = useRef<HTMLDivElement>(null);
  const title = engine === 'codex' ? 'Codex' : 'Claude Code';
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const refresh = async () => {
    const s = (await call('coding.status')) as Status;
    setStatus(s);
    setProfile((p) => p || s.profiles.find((p) => p.engine === engine)?.id || '');
    return s;
  };
  useEffect(() => {
    let live = true;
    void refresh()
      .then((s) => {
        if (live)
          setRuntime({
            directory: s.directory,
            codex: s.engines.find((e) => e.engine === 'codex')?.path || '',
            claude: s.engines.find((e) => e.engine === 'claude')?.path || '',
          });
      })
      .catch((e) => setError(String(e)));
    return () => {
      live = false;
    };
  }, [call, engine]);
  useEffect(() => {
    let live = true,
      inflight = false;
    const poll = async () => {
      if (inflight) return;
      inflight = true;
      try {
        const ts = (await call('coding.tasks')) as CodingTask[];
        if (live) setTasks(ts.filter((t) => t.engine === engine));
        const id = selectedRef.current;
        if (id) {
          const t = (await call('coding.task', { id })) as CodingTask;
          if (live && id === selectedRef.current) setTask(t);
        }
        if (login?.id) {
          const l = await call('coding.login.status', { id: login.id });
          if (live) setLogin(l);
        }
        if (status?.installs.some((i) => i.state === 'running')) await refresh();
      } catch (e) {
        if (live) setError(String(e));
      } finally {
        inflight = false;
      }
    };
    void poll();
    const timer = setInterval(() => {
      if (active) void poll();
    }, 1200);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [call, engine, active, login?.id, status?.installs.some((i) => i.state === 'running')]);
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [task?.messages.at(-1)?.text]);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const choose = (t?: CodingTask) => {
    setSideOpen(false);
    setSelected(t?.id || '');
    setTask(t ? { ...t, messages: [], events: [] } : undefined);
    if (t) {
      setCwd(t.cwd);
      setProfile(t.profileId);
    }
    setPanel('');
  };
  const draft = drafts[selected] || '',
    ready = status?.engines.find((e) => e.engine === engine),
    running = task && ['stopping', 'running', 'approval'].includes(task.state);
  const send = () =>
    act(async () => {
      const result = (await call('coding.start', {
        profileId: profile,
        cwd,
        prompt: draft,
        mode,
        ...(selected ? { resumeId: selected } : {}),
      })) as { id: string };
      setDrafts((v) => ({ ...v, [selected]: '' }));
      setSelected(result.id);
      setTask((await call('coding.task', { id: result.id })) as CodingTask);
    });
  const freshProfile = () =>
    setEdit({
      id: crypto.randomUUID(),
      engine,
      name: '',
      auth: 'official',
      endpoint: '',
      model: '',
    });
  return (
    <section className="coding-app" data-menu={sideOpen}>
      <aside className="coding-sidebar">
        <div className="coding-brand">
          <Code2 size={23} />
          <strong>{title}</strong>
        </div>
        <button className="coding-new" onClick={() => choose()}>
          <Plus size={16} />
          新会话
        </button>
        <small>这台机器的项目会话</small>
        <nav>
          {[...tasks].reverse().map((t) => (
            <button key={t.id} aria-current={selected === t.id} onClick={() => choose(t)}>
              <span>{t.title}</span>
              <small>
                {states[t.state]} · {t.profileName}
              </small>
            </button>
          ))}
        </nav>
        <button
          onClick={() => {
            setPanel('profiles');
            setSideOpen(false);
            setEdit(undefined);
          }}
        >
          <Settings size={16} />
          账号与基座
        </button>
        <button
          onClick={() => {
            setPanel('runtime');
            setSideOpen(false);
          }}
        >
          <Download size={16} />
          客户端安装
        </button>
      </aside>
      <main className="coding-main">
        <header>
          <button
            className="coding-menu-toggle"
            aria-label="会话与设置"
            aria-expanded={sideOpen}
            onClick={() => setSideOpen((v) => !v)}
          >
            <Menu size={20} />
          </button>
          <div>
            <strong>
              {panel === 'profiles'
                ? '账号与基座'
                : panel === 'runtime'
                  ? '客户端安装'
                  : task?.title || '新会话'}
            </strong>
            <small>
              {name}
              {task ? ' · ' + task.profileName : ''}
            </small>
          </div>
          <span />
          {panel && (
            <button title="返回会话" aria-label="返回会话" onClick={() => setPanel('')}>
              <ArrowLeft size={16} />
            </button>
          )}
          <button title="刷新状态" aria-label="刷新状态" onClick={() => void act(refresh)}>
            <RefreshCw size={16} />
          </button>
        </header>
        {error && (
          <div role="alert" className="coding-error">
            {error}
          </div>
        )}
        {panel === 'runtime' ? (
          <div className="coding-settings">
            <h2>在 {name} 上运行</h2>
            <p>独立安装目录，不修改系统软件源或全局环境。</p>
            <div className="coding-engine-status">
              <Code2 />
              <div>
                <strong>{title}</strong>
                <small>{ready?.ready ? ready.version : ready?.reason || '正在检查'}</small>
              </div>
              <span>{ready?.ready ? '已就绪' : '待配置'}</span>
            </div>
            <label>
              数据与账号目录
              <input
                value={runtime.directory}
                onChange={(e) => setRuntime({ ...runtime, directory: e.target.value })}
              />
            </label>
            <label>
              已有 {title} 可执行文件
              <input
                value={runtime[engine]}
                onChange={(e) => setRuntime({ ...runtime, [engine]: e.target.value })}
                placeholder="绝对路径，支持官方 CLI 或 JS 入口"
              />
            </label>
            <div className="coding-actions">
              <button
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await call('coding.configure', runtime);
                    await refresh();
                  })
                }
              >
                保存路径并检查
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void act(async () =>
                    setPlan(
                      await call('coding.install.plan', { engine, directory: runtime.directory }),
                    ),
                  )
                }
              >
                检查安装计划
              </button>
            </div>
            {plan && (
              <div className="coding-plan">
                <strong>
                  {title} · {plan.version}
                </strong>
                <p>{plan.directory}</p>
                {plan.steps.map((s: string) => (
                  <p key={s}>• {s}</p>
                ))}
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await call('coding.install', { id: plan.id });
                      setPlan(undefined);
                      await refresh();
                    })
                  }
                >
                  安装到此目录
                </button>
              </div>
            )}
            {status?.installs.map((i) => (
              <details key={i.id} open={i.state === 'running'}>
                <summary>安装 · {states[i.state] || i.state}</summary>
                <pre>{i.output}</pre>
                {i.state === 'running' && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        await call('coding.install.cancel', { id: i.id });
                        await refresh();
                      })
                    }
                  >
                    取消安装
                  </button>
                )}
              </details>
            ))}
          </div>
        ) : panel === 'profiles' ? (
          <div className="coding-settings">
            <div className="coding-section-title">
              <h2>选择模型服务</h2>
              <button onClick={freshProfile}>
                <Plus size={16} />
                添加基座
              </button>
            </div>
            <div className="coding-profile-grid">
              {status?.profiles
                .filter((p) => p.engine === engine)
                .map((p) => (
                  <button
                    key={p.id}
                    className={profile === p.id ? 'selected' : ''}
                    onClick={() => {
                      setSelected('');
                      setTask(undefined);
                      setProfile(p.id);
                      setEdit({ ...p, key: undefined } as CodingProfile);
                    }}
                  >
                    <Globe size={20} />
                    <strong>{p.name}</strong>
                    <small>{p.auth === 'official' ? '官方账号' : p.model}</small>
                    <small>
                      {p.auth === 'api' ? (p.hasKey ? '已保存密钥' : '未配置密钥') : '独立登录资料'}
                    </small>
                  </button>
                ))}
            </div>
            {edit && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void act(async () => {
                    const { hasKey, ...value } = edit as CodingProfile & { hasKey?: boolean };
                    await call('coding.profile.save', value);
                    setProfile(edit.id);
                    setEdit(undefined);
                    await refresh();
                  });
                }}
              >
                <label>
                  名称
                  <input
                    required
                    value={edit.name}
                    onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                  />
                </label>
                <label>
                  认证方式
                  <select
                    value={edit.auth}
                    onChange={(e) =>
                      setEdit({ ...edit, auth: e.target.value as 'official' | 'api' })
                    }
                  >
                    <option value="official">官方账号登录</option>
                    <option value="api">自定义 API 基座</option>
                  </select>
                </label>
                {edit.auth === 'api' && (
                  <>
                    <label>
                      接口地址
                      <input
                        required
                        value={edit.endpoint}
                        onChange={(e) => setEdit({ ...edit, endpoint: e.target.value })}
                        placeholder={
                          engine === 'codex'
                            ? 'https://服务地址/v1 · Responses 协议'
                            : 'https://服务地址 · Anthropic Messages 协议'
                        }
                      />
                    </label>
                    <label>
                      模型
                      <input
                        required
                        value={edit.model}
                        onChange={(e) => setEdit({ ...edit, model: e.target.value })}
                      />
                    </label>
                    <label>
                      API Key
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={edit.key ?? ''}
                        onChange={(e) => setEdit({ ...edit, key: e.target.value || undefined })}
                        placeholder="留空保留已有密钥"
                      />
                    </label>
                  </>
                )}
                <div className="coding-actions">
                  <button className="primary" disabled={busy}>
                    <Check size={16} />
                    保存基座
                  </button>
                  <button type="button" onClick={() => setEdit(undefined)}>
                    取消编辑
                  </button>
                </div>
              </form>
            )}
            {profile && status?.profiles.some((p) => p.id === profile) && (
              <div className="coding-actions">
                {status.profiles.find((p) => p.id === profile)?.auth === 'official' && (
                  <button
                    disabled={busy || !ready?.ready || login?.state === 'running'}
                    onClick={() =>
                      void act(async () => setLogin(await call('coding.login', { id: profile })))
                    }
                  >
                    <Globe size={16} />
                    开始官方登录
                  </button>
                )}
                <button
                  title="移除此基座配置"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await call('coding.profile.remove', { id: profile });
                      setProfile('');
                      setEdit(undefined);
                      await refresh();
                    })
                  }
                >
                  <Trash2 size={16} />
                  移除配置
                </button>
              </div>
            )}
            {login && (
              <div className="coding-plan">
                <strong>官方登录 · {states[login.state] || login.state}</strong>
                {login.url && (
                  <button onClick={() => void act(() => openBrowser(login.url))}>
                    <Globe size={16} />
                    在这台机器的浏览器中继续
                  </button>
                )}
                {login.error && <p role="alert">{login.error}</p>}
                {engine === 'claude' && login.state === 'running' && (
                  <label>
                    网页返回登录码时填写
                    <input
                      type="password"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      autoComplete="off"
                    />
                    <button
                      disabled={!code || busy}
                      onClick={() =>
                        void act(async () => {
                          await call('coding.login.input', { id: login.id, text: code });
                          setCode('');
                        })
                      }
                    >
                      提交登录码
                    </button>
                  </label>
                )}
                {login.state === 'running' && (
                  <button
                    onClick={() =>
                      void act(async () =>
                        setLogin(await call('coding.login.cancel', { id: login.id })),
                      )
                    }
                  >
                    取消登录
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="coding-project">
              <Folder size={16} />
              <input
                aria-label="服务器项目目录"
                placeholder="服务器上的项目绝对路径"
                value={cwd}
                readOnly={!!selected}
                onChange={(e) => setCwd(e.target.value)}
              />
              <span className="coding-ready">{ready?.ready ? '引擎就绪' : '需要安装客户端'}</span>
            </div>
            <div className="coding-conversation" ref={scroll}>
              {!task ? (
                <div className="coding-empty">
                  <div>
                    <Code2 size={34} />
                  </div>
                  <h2>在 {name} 开始编程</h2>
                  <p>选择项目与基座，描述要完成的工作。</p>
                  {!ready?.ready ? (
                    <button onClick={() => setPanel('runtime')}>安装或连接 {title}</button>
                  ) : !profile ? (
                    <button onClick={() => setPanel('profiles')}>添加官方账号或 API 基座</button>
                  ) : (
                    <small>
                      {title} · {status?.profiles.find((p) => p.id === profile)?.name}
                    </small>
                  )}
                </div>
              ) : (
                <>
                  {task.messages.map((m, i) => (
                    <article key={i} className={'coding-message ' + m.role}>
                      <small>{m.role === 'user' ? '你' : title}</small>
                      <Markdown remarkPlugins={[remarkGfm]}>{m.text}</Markdown>
                    </article>
                  ))}
                  {task.events.length > 0 && (
                    <details className="coding-tools">
                      <summary>执行与文件改动 · {task.events.length}</summary>
                      {task.events.map((e, i) => (
                        <details key={i}>
                          <summary>{e.kind}</summary>
                          <pre>{e.text}</pre>
                        </details>
                      ))}
                    </details>
                  )}
                  {task.approval && (
                    <div className="coding-plan">
                      <strong>
                        <ShieldCheck size={16} />
                        等待执行授权 · {name}
                      </strong>
                      <pre>{JSON.stringify(task.approval.details, null, 2)}</pre>
                      <div className="coding-actions">
                        {[true, false].map((accept) => (
                          <button
                            key={String(accept)}
                            disabled={busy}
                            onClick={() =>
                              void act(async () => {
                                await call('coding.approve', {
                                  id: task.id,
                                  approvalId: task.approval!.id,
                                  accept,
                                });
                                setTask((await call('coding.task', { id: task.id })) as CodingTask);
                              })
                            }
                          >
                            {accept ? '允许本次' : '拒绝'}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {task.error && <p className="coding-error">{task.error}</p>}
                  <small>{states[task.state]}</small>
                </>
              )}
            </div>
            <form
              className="coding-compose"
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <textarea
                placeholder="描述任务，Ctrl+Enter 发送…"
                aria-label="编程任务"
                value={draft}
                onChange={(e) => setDrafts({ ...drafts, [selected]: e.target.value })}
                onKeyDown={(e) => {
                  if (
                    e.ctrlKey &&
                    e.key === 'Enter' &&
                    !e.nativeEvent.isComposing &&
                    !running &&
                    !busy &&
                    draft.trim()
                  ) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <div>
                <select
                  aria-label="模型基座"
                  value={profile}
                  title="切换基座将新建会话，原任务保持不变"
                  onChange={(e) => {
                    setSelected('');
                    setTask(undefined);
                    setProfile(e.target.value);
                  }}
                >
                  <option value="">选择基座</option>
                  {status?.profiles
                    .filter((p) => p.engine === engine)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
                <select
                  aria-label="执行范围"
                  value={mode}
                  disabled={!!running}
                  onChange={(e) => setMode(e.target.value)}
                >
                  <option value="read">只读分析</option>
                  <option value="edit">修改项目文件</option>
                  <option value="execute">修改并执行命令</option>
                </select>
                <span />
                {running ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void act(() => call('coding.stop', { id: selected }))}
                  >
                    <Square size={15} />
                    停止
                  </button>
                ) : (
                  <button
                    className="primary"
                    disabled={busy || !ready?.ready || !profile || !cwd || !draft.trim()}
                  >
                    <Send size={15} />
                    发送
                  </button>
                )}
              </div>
            </form>
          </>
        )}
      </main>
    </section>
  );
}
