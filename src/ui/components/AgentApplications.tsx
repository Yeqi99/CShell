import { useEffect, useState } from 'react';
import { appCatalogSchema, appTaskSchema, appPolicySchema } from '../../shared/agent-applications';
import type { AgentCall, AgentTarget } from '../../shared/agent';
import type { z } from 'zod';
import { AgentCapabilityMarket } from './AgentCapabilityMarket';
import { AgentWsl } from './AgentWsl';

export function AgentApplications({
  target,
  call,
}: {
  target: AgentTarget;
  call: (method: AgentCall['method'], params?: unknown) => Promise<unknown>;
}) {
  const [catalog, setCatalog] = useState<z.infer<typeof appCatalogSchema>>(),
    [task, setTask] = useState<z.infer<typeof appTaskSchema>>();
  const [policy, setPolicy] = useState<z.infer<typeof appPolicySchema>>(),
    [controllers, setControllers] = useState('');
  const [wslOpen,setWslOpen]=useState(false);
  const [query, setQuery] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const refresh = async () => {
    setCatalog(appCatalogSchema.parse(await call('applications.list')));
    {
      const p = appPolicySchema.parse(await call('applications.policy'));
      setPolicy(p);
      setControllers(p.controllers.join('\n'));
    }
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
          {target.name} · {catalog?.platform ?? '检查中'} · {catalog?.manager ?? '未检测到包管理器'}
        </p>
      </header>
      <AgentCapabilityMarket key={target.id} target={target} call={call} />
      {catalog?.platform==='win32'&&<details className="agent-system-apps" onToggle={e=>setWslOpen(e.currentTarget.open)}><summary>Linux 虚拟机 · WSL</summary>{wslOpen&&<AgentWsl target={target.id} call={call}/>}</details>}
      {error && <p role="alert" className="form-error">{error}</p>}
      {busy && <p role="status">正在处理应用操作…</p>}
      <details>
        <summary>系统应用</summary>
        {policy && (
          <details>
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
        <div className="agent-toolbar">
          <input
            aria-label="搜索应用"
            placeholder="搜索应用"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button disabled={busy} onClick={() => void run(refresh)}>
            刷新
          </button>
        </div>
        <div className="agent-app-grid">
          {catalog?.applications
            .filter((a) => (a.id + ' ' + a.package).toLowerCase().includes(query.toLowerCase()))
            .map((a) => (
              <button
                key={a.id}
                disabled={busy || !catalog.enabled || task?.state === 'running'}
                onClick={() =>
                  void run(async () =>
                    setTask(appTaskSchema.parse(await call('applications.plan', { app: a.id }))),
                  )
                }
              >
                <strong>{a.id}</strong>
                <small>{a.package}</small>
              </button>
            ))}
        </div>
        {task && (
          <section>
            <h3>
              {task.app} · {task.state}
            </h3>
            <p>安装目标：{target.name}</p>
            <code>{[task.executable, ...task.args].join(' ')}</code>
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
      </details>
    </section>
  );
}
