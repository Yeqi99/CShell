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
  permissions?: Record<string,string>;
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
  onManage,
}: {
  engine: CodingEngine;
  name: string;
  call: (method: AgentCall['method'], params?: unknown) => Promise<unknown>;
  openBrowser: (url: string) => Promise<void>;
  active: boolean;
  onManage?: () => void;
}) {
  const [sideOpen, setSideOpen] = useState(false);
  const [checking, setChecking] = useState(true);
  const [statusError, setStatusError] = useState('');
  const [status, setStatus] = useState<Status>(),
    [tasks, setTasks] = useState<CodingTask[]>([]),
    [selected, setSelected] = useState(''),
    [task, setTask] = useState<CodingTask>(),
    [profile, setProfile] = useState(''),
    [cwd, setCwd] = useState(''),
    [mode, setMode] = useState('read'),
    [drafts, setDrafts] = useState<Record<string, string>>({}),
    [panel, setPanel] = useState<'' | 'profiles'>(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [edit, setEdit] = useState<CodingProfile>(),
    [login, setLogin] = useState<any>(),
    [code, setCode] = useState('');
  const scroll = useRef<HTMLDivElement>(null);
  const openedLogin = useRef('');
  useEffect(() => {
    if (!login?.url || login.state !== 'running' || openedLogin.current === login.id) return;
    openedLogin.current = login.id;
    void openBrowser(login.url).catch((e) => setError('无法打开机器浏览器：' + String(e)));
  }, [login?.id, login?.url, login?.state, openBrowser]);
  const title = engine === 'codex' ? 'Codex' : 'Claude Code';
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const refresh = async () => {
    setChecking(true);
    try {
      let s: Status | undefined;
      for (let attempt = 0; ; attempt++) {
        try {
          s = (await call('coding.status')) as Status;
          break;
        } catch (e) {
          // Reopening a machine can race its TLS connection. Retry reads only,
          // never installation, authentication, or task execution.
          if (
            attempt >= 2 ||
            !/socket|network|ECONN|TLS|disconnected|timeout|尚未连接|断开/i.test(String(e))
          )
            throw e;
          await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
        }
      }
      setStatus(s);
      setMode(m=>['read','edit','execute'].indexOf(m)>['read','edit','execute'].indexOf(s.permissions?.[engine]??'execute')?'read':m);
      setStatusError('');
      setProfile((p) => p || s.profiles.find((p) => p.engine === engine)?.id || '');
      return s;
    } catch (e) {
      setStatus(undefined);
      setStatusError(
        '无法读取这台机器的编程服务。请确认远端 cagent 已更新至 0.8.0 或更高版本，并已开放管理权限，然后刷新重试。',
      );
      throw e;
    } finally {
      setChecking(false);
    }
  };
  useEffect(() => {
    void refresh().catch(() => {});
  }, [call, engine]);
  useEffect(() => {
    let live = true,
      inflight = false;
    const poll = async () => {
      if (inflight || !status || statusError) return;
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
      if (active || login?.state === 'running') void poll();
    }, 1200);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [
    call,
    engine,
    active,
    login?.id,
    !!status,
    statusError,
    status?.installs.some((i) => i.state === 'running'),
  ]);
  useEffect(() => {
    if (task && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
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
        {onManage && (
          <button onClick={onManage}>
            <Download size={16} />
            在应用市场管理
          </button>
        )}
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
            <strong>{panel === 'profiles' ? '账号与基座' : task?.title || '新会话'}</strong>
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
        {(statusError || error) && (
          <div role="alert" className="coding-error">
            {statusError ||
              error.replace(/^Error: (?:Error invoking remote method '[^']+': Error: )?/, '')}
          </div>
        )}
        {panel === 'profiles' || (ready?.ready && !profile) ? (
          <div className="coding-settings">
            <div className="coding-account-intro">
              <span>
                <Code2 size={28} />
              </span>
              <div>
                <h2>连接 {title}</h2>
                <p>选择官方账号或自己的模型服务，在 {name} 上开始工作。</p>
              </div>
            </div>
            <div className="coding-auth-choices">
              <button
                disabled={busy || !ready?.ready || login?.state === 'running'}
                onClick={() =>
                  void act(async () => {
                    let p = status?.profiles.find(
                      (p) => p.engine === engine && p.auth === 'official',
                    );
                    if (!p) {
                      const value = {
                        id: crypto.randomUUID(),
                        engine,
                        name: engine === 'codex' ? 'ChatGPT 账号' : 'Claude 账号',
                        auth: 'official' as const,
                        endpoint: '',
                        model: '',
                      };
                      await call('coding.profile.save', value);
                      await refresh();
                      p = { ...value, hasKey: false };
                    }
                    setProfile(p.id);
                    setPanel('profiles');
                    setLogin(await call('coding.login', { id: p.id }));
                  })
                }
              >
                <Globe size={22} />
                <strong>{engine === 'codex' ? '使用 ChatGPT 登录' : '使用 Claude 登录'}</strong>
                <small>在这台机器的浏览器完成官方授权</small>
              </button>
              <button
                onClick={() => {
                  freshProfile();
                  setEdit({
                    id: crypto.randomUUID(),
                    engine,
                    name: '',
                    auth: 'api',
                    endpoint: '',
                    model: '',
                  });
                  setPanel('profiles');
                }}
              >
                <Settings size={22} />
                <strong>使用 API 基座</strong>
                <small>保存多个服务，按会话切换</small>
              </button>
            </div>
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
              <span className="coding-ready">
                {checking
                  ? '正在检查'
                  : statusError
                    ? '状态不可用'
                    : ready?.ready
                      ? '引擎就绪'
                      : '未配置客户端'}
              </span>
            </div>
            <div className="coding-conversation" ref={scroll}>
              {!task ? (
                <div className="coding-empty">
                  <div>
                    <Code2 size={34} />
                  </div>
                  <h2>{title}</h2>
                  <p>
                    {checking
                      ? '正在检查编程环境…'
                      : statusError
                        ? '连接恢复后，可继续配置项目与基座。'
                        : !ready?.ready
                          ? '请到应用市场安装并验证客户端。'
                          : '选择项目与基座，描述要完成的工作。'}
                  </p>
                  {ready?.ready && !profile ? (
                    <button onClick={() => setPanel('profiles')}>添加官方账号或 API 基座</button>
                  ) : ready?.ready ? (
                    <small>
                      {title} · {status?.profiles.find((p) => p.id === profile)?.name}
                    </small>
                  ) : null}
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
                    ready?.ready &&
                    profile &&
                    cwd &&
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
                  {status?.permissions?.[engine]!=='read'&&<option value="edit">修改项目文件</option>}
                  {(!status?.permissions?.[engine]||status.permissions[engine]==='execute')&&<option value="execute">修改并执行命令</option>}
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
