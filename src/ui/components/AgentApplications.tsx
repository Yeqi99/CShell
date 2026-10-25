import { ErrorNotice } from './ErrorNotice';
import { useEffect, useState } from 'react';
import { appCatalogSchema, appTaskSchema, appPolicySchema } from '../../shared/agent-applications';
import type { AgentCall, AgentTarget } from '../../shared/agent';
import type { z } from 'zod';
import { AgentCapabilityMarket } from './AgentCapabilityMarket';
import { AgentWsl } from './AgentWsl';
import { RefreshCw, Package, Terminal, Globe, Code, Search } from 'lucide-react';
import './agent-applications.css';
import { DevelopmentMarket } from './DevelopmentMarket';
import { agentRead } from '../agent-read';
import { agentCapabilityError, agentCompatibilityNotice } from '../../shared/agent-compatibility';
import { SshApplicationMarket } from './SshApplicationMarket';

export function AgentApplications({
  target,
  call,
  onDevelopmentOpen,
  onDevelopmentChanged,
  nativeCapabilities = true,
}: {
  target: AgentTarget;
  onIde?: () => void;
  nativeCapabilities?: boolean;
  onDevelopmentOpen?: (id: string) => void;
  onDevelopmentChanged?: () => void;
  call: (method: AgentCall['method'], params?: unknown) => Promise<unknown>;
}) {
  const stateLabel = (state: string) =>
    ({
      planned: '待确认',
      running: '安装中',
      completed: '已完成',
      failed: '失败',
      interrupted: '已中断',
    })[state] || state;
  const [catalog, setCatalog] = useState<z.infer<typeof appCatalogSchema>>(),
    [task, setTask] = useState<z.infer<typeof appTaskSchema>>();
  const [policy, setPolicy] = useState<z.infer<typeof appPolicySchema>>(),
    [controllers, setControllers] = useState('');
  const [detail, setDetail] = useState(false);
  const [wslOpen, setWslOpen] = useState(false);
  const [query, setQuery] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''), [compatibility,setCompatibility]=useState('');
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(agentCapabilityError(e));
    } finally {
      setBusy(false);
    }
  };
  const refresh = async () => {
    const results = await Promise.allSettled([
      agentRead(() => call('applications.list')).then(v=>appCatalogSchema.parse(v)),
      agentRead(() => call('applications.policy')).then(v=>appPolicySchema.parse(v)),
    ]);
    setCatalog(results[0].status==='fulfilled'?results[0].value:undefined);
    if(results[1].status==='fulfilled') {
      const p = results[1].value;
      setPolicy(p);
      setControllers(p.controllers.join('\n'));
    } else setPolicy(undefined);
    const failures=results.filter(r=>r.status==='rejected').map(r=>agentCapabilityError(r.reason));
    setCompatibility(failures.includes(agentCompatibilityNotice)?agentCompatibilityNotice:'');
    setError([...new Set(failures.filter(message=>message!==agentCompatibilityNotice))].join(' '));
  };
  useEffect(() => {
    void run(refresh);
  }, [target.id]);
  useEffect(() => {
    if (task?.state !== 'running') return;
    let disposed = false,
      pending = false;
    const timer = setInterval(() => {
      if (pending) return;
      pending = true;
      void call('applications.status', { id: task.id })
        .then((v) => {
          if (!disposed) setTask(appTaskSchema.parse(v));
        })
        .catch((e) => {
          if (!disposed) setError(String(e));
        })
        .finally(() => {
          pending = false;
        });
    }, 1500);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [task?.id, task?.state, target.id]);
  return (
    <section className="agent-applications">
      <header>
        <h2>应用市场</h2>
        <p>
          {target.name} · {catalog?.platform ?? '检查中'}
        </p>
      </header>
      <div hidden={detail}>
        {target.id.startsWith('ssh:')&&<SshApplicationMarket key={target.id} sessionId={target.id.slice(4)} name={target.name}/>}
        <DevelopmentMarket
          call={call}
          onOpen={onDevelopmentOpen}
          onChanged={onDevelopmentChanged}
        />
        {nativeCapabilities && !target.id.startsWith('ssh:') && (
          <AgentCapabilityMarket key={target.id} target={target} call={call} />
        )}
        {nativeCapabilities && catalog?.platform === 'win32' && (
          <details className="agent-system-apps" onToggle={(e) => setWslOpen(e.currentTarget.open)}>
            <summary>Linux 虚拟机 · WSL</summary>
            {wslOpen && <AgentWsl target={target.id} call={call} />}
          </details>
        )}
      </div>
      {error && (
        <ErrorNotice title="应用操作未完成" error={error} />
      )}
      {compatibility&&<p role="status">{compatibility}</p>}
      {busy && <p role="status">正在处理应用操作…</p>}
      <div className="machine-app-catalog">
        {policy && !detail && !target.id.startsWith('ssh:') && (
          <details className="machine-app-permissions">
            <summary>应用安装权限</summary>
            <label>
              <input
                type="checkbox"
                checked={policy.enabled}
                onChange={(e) => setPolicy({ ...policy, enabled: e.target.checked })}
              />
              允许本机安装应用
            </label>
            <label>
              允许远程安装的控制端指纹（每行一个）
              <textarea value={controllers} onChange={(e) => setControllers(e.target.value)} />
            </label>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await call('applications.configure', {
                    ...policy,
                    controllers: controllers
                      .split(/\r?\n/)
                      .map((x) => x.trim())
                      .filter(Boolean),
                  });
                  await refresh();
                })
              }
            >
              保存权限
            </button>
          </details>
        )}
        {catalog && !catalog.enabled && (
          <p>应用安装未授权。请在目标 CAgent 本机的应用安装权限中启用；远程控制端还需指纹授权。</p>
        )}
        {task && (
          <div className="market-navigation">
            <button onClick={() => setDetail(!detail)}>
              {detail ? '← 返回应用目录' : '查看安装任务'}
            </button>
            <span>
              {task.app} · {stateLabel(task.state)}
            </span>
          </div>
        )}
        <div className="agent-toolbar" hidden={detail}>
          <Search size={16} aria-hidden="true" />
          <input
            aria-label="搜索应用"
            placeholder="搜索应用"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            title="刷新应用"
            aria-label="刷新应用"
            disabled={busy}
            onClick={() => void run(refresh)}
          >
            <RefreshCw size={16} />
          </button>
        </div>
        <div className="agent-app-grid" hidden={detail}>
          {catalog?.applications
            .filter((a) => nativeCapabilities || a.id !== 'browser')
            .filter((a) => (a.id + ' ' + a.package).toLowerCase().includes(query.toLowerCase()))
            .map((a) => (
              <button
                key={a.id}
                disabled={busy || !catalog.enabled || task?.state === 'running'}
                onClick={() =>
                  void run(async () => {
                    setTask(appTaskSchema.parse(await call('applications.plan', { app: a.id })));
                    setDetail(true);
                  })
                }
              >
                <span className="machine-app-icon">
                  {a.id === 'browser' ? (
                    <Globe size={24} />
                  ) : ['python', 'nodejs'].includes(a.id) ? (
                    <Code size={24} />
                  ) : a.id === 'git' ? (
                    <Terminal size={24} />
                  ) : (
                    <Package size={24} />
                  )}
                </span>
                <strong>{a.id === 'browser' ? 'Linux 图形环境' : a.id}</strong>
                <small>{a.id === 'browser' ? '原生应用兼容 · 含 Chrome' : a.package}</small>
              </button>
            ))}
        </div>
        {task && detail && (
          <section>
            <h3>
              {task.app} · {stateLabel(task.state)}
            </h3>
            <p>安装目标：{target.name}</p>
            <code>
              {task.app === 'browser'
                ? 'Google Chrome · 官方签名软件源'
                : [task.executable, ...task.args].join(' ')}
            </code>
            <p>{task.warning}</p>
            <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 260, overflow: 'auto' }}>
              {task.logs}
            </pre>
            {task.state === 'planned' && (
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () =>
                    setTask(
                      appTaskSchema.parse(
                        await call('applications.install', { id: task.id, confirm: true }),
                      ),
                    ),
                  )
                }
              >
                确认并安装
              </button>
            )}
            {['planned', 'running'].includes(task.state) && (
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () =>
                    setTask(
                      appTaskSchema.parse(await call('applications.cancel', { id: task.id })),
                    ),
                  )
                }
              >
                取消任务
              </button>
            )}
          </section>
        )}
      </div>
    </section>
  );
}
