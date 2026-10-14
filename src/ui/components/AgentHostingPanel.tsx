import { useEffect, useRef, useState } from 'react';
import { Plus, RefreshCw, Save, Play, Square, Trash2 } from 'lucide-react';
import type { AgentCall } from '../../shared/agent';
import {
  hostingConfigSchema,
  type HostingConfig,
  type HostingLog,
  type HostingStatus,
} from '../../shared/agent-hosting';
import './agent-hosting.css';

type Props = {
  call: (method: AgentCall['method'], params?: unknown) => Promise<any>;
  target: string;
};
const newConfig = (): HostingConfig =>
  hostingConfigSchema.parse({
    id: crypto.randomUUID(),
    name: 'HTTP 服务',
    routes: [{ method: 'GET', path: '/', body: '' }],
  });

// A different target creates a different editing context; pending results stay on their original target.
export function AgentHostingPanel(props: Props) {
  return <HostingEditor key={props.target} {...props} />;
}
function HostingEditor({ call, target }: Props) {
  const [services, setServices] = useState<HostingStatus[]>([]);
  const [draft, setDraft] = useState<HostingConfig>();
  const [routeIndex, setRouteIndex] = useState(0);
  const [logs, setLogs] = useState<HostingLog[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [allowCode, setAllowCode] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const drafts = useRef(new Map<string, HostingConfig>());
  const alive = useRef(true);
  const callRef = useRef(call);
  callRef.current = call;
  const active = services.find((s) => s.config.id === draft?.id);
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(active?.config);
  const route = draft?.routes[routeIndex];
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function refresh() {
    const result = (await callRef.current('hosting.list')) as HostingStatus[];
    if (alive.current) setServices(result);
  }
  useEffect(() => {
    alive.current = true;
    void run(refresh);
    return () => {
      alive.current = false;
    };
  }, []);
  function edit(value: HostingConfig) {
    drafts.current.set(value.id, value);
    setDraft(value);
    setAllowCode(false);
    setConfirmRemove(false);
  }
  function editRoute(patch: Partial<HostingConfig['routes'][number]>) {
    if (!draft) return;
    edit({
      ...draft,
      routes: draft.routes.map((r, i) => (i === routeIndex ? { ...r, ...patch } : r)),
    });
  }
  function choose(value: HostingConfig) {
    edit(structuredClone(drafts.current.get(value.id) ?? value));
    setRouteIndex(0);
    setShowLogs(false);
    setLogs([]);
    setError('');
    setNotice('');
  }
  const icon = (label: string, child: React.ReactNode, action: () => void, disabled = busy) => (
    <button
      type="button"
      className="icon"
      title={label}
      aria-label={label}
      onClick={action}
      disabled={disabled}
    >
      {child}
    </button>
  );
  return (
    <section className="agent-hosting" aria-label="HTTP 服务托管">
      <header>
        <strong>HTTP 服务</strong>
        <span className="hosting-target">{target}</span>
        {icon('刷新 HTTP 服务', <RefreshCw size={16} />, () => void run(refresh))}
        {icon('新建 HTTP 服务', <Plus size={16} />, () => choose(newConfig()))}
      </header>
      {error && (
        <p role="alert" className="hosting-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <div className="hosting-layout">
        <nav aria-label="HTTP 服务列表">
          {services.map((service) => (
            <button
              type="button"
              key={service.config.id}
              className={draft?.id === service.config.id ? 'selected' : ''}
              onClick={() => choose(service.config)}
              disabled={busy}
            >
              <strong>{service.config.name}</strong>
              <small>
                {service.running ? `${service.config.host}:${service.actualPort}` : '已停止'} ·{' '}
                {service.environment === 'windows'
                  ? 'Windows 主机'
                  : service.environment === 'darwin'
                    ? 'macOS 主机'
                    : 'Linux 主机'}
              </small>
            </button>
          ))}
          {[...drafts.current.values()]
            .filter((value) => !services.some((s) => s.config.id === value.id))
            .map((value) => (
              <button
                type="button"
                key={value.id}
                className={draft?.id === value.id ? 'selected' : ''}
                disabled={busy}
                onClick={() => choose(value)}
              >
                <strong>{value.name}</strong>
                <small>未保存</small>
              </button>
            ))}
          {!services.length && !drafts.current.size && <p>暂无服务</p>}
        </nav>
        {!draft ? (
          <div className="hosting-empty">新建服务后，配置路由并手动启动。</div>
        ) : (
          <div className="hosting-editor">
            <div className="hosting-actions">
              <strong>
                {active?.running ? '运行中' : '已停止'}
                {dirty ? ' · 未保存' : ''}
              </strong>
              {icon(
                '保存 HTTP 服务',
                <Save size={16} />,
                () =>
                  void run(async () => {
                    const parsed = hostingConfigSchema.parse(draft);
                    const saved = (await call('hosting.save', { config: parsed })) as HostingStatus;
                    if (!alive.current) return;
                    drafts.current.set(saved.config.id, saved.config);
                    setDraft(saved.config);
                    setAllowCode(false);
                    await refresh();
                    if (alive.current) setNotice('已保存');
                  }),
                busy || !!active?.running,
              )}
              {active?.running
                ? icon(
                    '停止 HTTP 服务',
                    <Square size={16} />,
                    () =>
                      void run(async () => {
                        await call('hosting.stop', { id: draft.id });
                        await refresh();
                      }),
                  )
                : icon(
                    '启动 HTTP 服务',
                    <Play size={16} />,
                    () =>
                      void run(async () => {
                        await call('hosting.start', {
                          id: draft.id,
                          allowCode,
                          expectedRevision: draft.revision,
                        });
                        await refresh();
                      }),
                    busy ||
                      dirty ||
                      !active ||
                      (draft.routes.some((r) => r.mode === 'code') && !allowCode),
                  )}
              <button
                type="button"
                disabled={busy || !active}
                onClick={() =>
                  void run(async () => {
                    const result = (await call('hosting.logs', { id: draft.id })) as HostingLog[];
                    if (alive.current) {
                      setLogs(result);
                      setShowLogs(true);
                    }
                  })
                }
              >
                日志
              </button>
              {icon(
                '删除 HTTP 服务',
                <Trash2 size={16} />,
                () => setConfirmRemove(true),
                busy || !active || !!active.running,
              )}
            </div>
            {confirmRemove && (
              <div className="hosting-confirm">
                <span>删除“{draft.name}”的配置与日志？</span>
                <button type="button" onClick={() => setConfirmRemove(false)}>
                  取消
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await call('hosting.remove', { id: draft.id });
                      if (alive.current) {
                        drafts.current.delete(draft.id);
                        setDraft(undefined);
                        setConfirmRemove(false);
                      }
                      await refresh();
                    })
                  }
                >
                  确认删除
                </button>
              </div>
            )}
            {active?.error && <p role="alert">{active.error}</p>}
            {showLogs ? (
              <div className="hosting-logs">
                <button type="button" onClick={() => setShowLogs(false)}>
                  返回配置
                </button>
                {logs.length === 0 && <p>暂无请求记录</p>}
                {[...logs].reverse().map((log, i) => (
                  <details key={`${log.time}-${i}`}>
                    <summary>
                      {new Date(log.time).toLocaleTimeString()} · {log.method} {log.path} ·{' '}
                      {log.status} · {log.durationMs} ms
                    </summary>
                    {log.error && <p>{log.error}</p>}
                    {log.body !== undefined && (
                      <pre>
                        {log.body}
                        {log.truncated ? '\n（记录已截断）' : ''}
                      </pre>
                    )}
                  </details>
                ))}
              </div>
            ) : (
              <>
                <fieldset disabled={busy || !!active?.running}>
                  <div className="hosting-fields">
                    <label>
                      名称
                      <input
                        value={draft.name}
                        maxLength={100}
                        onChange={(e) => edit({ ...draft, name: e.target.value })}
                      />
                    </label>
                    <label>
                      监听地址
                      <input
                        value={draft.host}
                        onChange={(e) => edit({ ...draft, host: e.target.value })}
                      />
                    </label>
                    <label>
                      端口
                      <input
                        type="number"
                        min={0}
                        max={65535}
                        value={draft.port}
                        onChange={(e) => edit({ ...draft, port: Number(e.target.value) })}
                      />
                    </label>
                  </div>
                  <label className="hosting-check">
                    <input
                      type="checkbox"
                      checked={draft.allowExternal}
                      onChange={(e) => edit({ ...draft, allowExternal: e.target.checked })}
                    />
                    允许非回环地址监听
                  </label>
                  <small>
                    端口 0 自动分配。服务运行在所选 Agent 的原生主机，Windows 服务不进入 WSL。
                  </small>
                </fieldset>
                <div className="hosting-routes">
                  <div role="tablist" aria-label="托管路由">
                    {draft.routes.map((r, i) => (
                      <button
                        type="button"
                        role="tab"
                        aria-selected={routeIndex === i}
                        key={i}
                        onClick={() => setRouteIndex(i)}
                      >
                        {r.method} {r.path}
                      </button>
                    ))}
                  </div>
                  {icon(
                    '添加托管路由',
                    <Plus size={15} />,
                    () => {
                      edit({
                        ...draft,
                        routes: [
                          ...draft.routes,
                          {
                            method: 'GET',
                            path: `/route-${draft.routes.length + 1}`,
                            mode: 'fixed',
                            status: 200,
                            headers: {},
                            body: '',
                          },
                        ],
                      });
                      setRouteIndex(draft.routes.length);
                    },
                    busy || !!active?.running || draft.routes.length >= 100,
                  )}
                </div>
                <fieldset disabled={busy || !!active?.running}>
                  {route && (
                    <div className="hosting-route">
                      <div className="hosting-fields">
                        <label>
                          方法
                          <select
                            aria-label="方法"
                            value={route.method}
                            onChange={(e) =>
                              editRoute({ method: e.target.value as typeof route.method })
                            }
                          >
                            {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map(
                              (method) => (
                                <option key={method}>{method}</option>
                              ),
                            )}
                          </select>
                        </label>
                        <label>
                          路径
                          <input
                            value={route.path}
                            onChange={(e) => editRoute({ path: e.target.value })}
                          />
                        </label>
                        <label>
                          处理方式
                          <select
                            aria-label="处理方式"
                            value={route.mode}
                            onChange={(e) =>
                              editRoute({ mode: e.target.value as typeof route.mode })
                            }
                          >
                            <option value="fixed">固定响应</option>
                            <option value="callback">回调记录</option>
                            <option value="code">自定义代码</option>
                          </select>
                        </label>
                        {icon(
                          '删除当前路由',
                          <Trash2 size={15} />,
                          () => {
                            edit({
                              ...draft,
                              routes: draft.routes.filter((_, i) => i !== routeIndex),
                            });
                            setRouteIndex(Math.max(0, routeIndex - 1));
                          },
                          busy || !!active?.running || draft.routes.length === 1,
                        )}
                      </div>
                      <label>
                        响应状态
                        <input
                          type="number"
                          min={200}
                          max={599}
                          value={route.status}
                          onChange={(e) => editRoute({ status: Number(e.target.value) })}
                        />
                      </label>
                      <div className="hosting-headers">
                        <div>
                          <strong>响应头</strong>
                          {icon(
                            '添加响应头',
                            <Plus size={15} />,
                            () => {
                              let name = 'x-header';
                              while (name in route.headers) name += '-new';
                              editRoute({ headers: { ...route.headers, [name]: '' } });
                            },
                            busy || !!active?.running || Object.keys(route.headers).length >= 32,
                          )}
                        </div>
                        {Object.entries(route.headers).map(([name, value], i) => (
                          <div key={i}>
                            <input
                              aria-label={`响应头名称 ${i + 1}`}
                              value={name}
                              onChange={(e) => {
                                const entries = Object.entries(route.headers);
                                entries[i] = [e.target.value, value];
                                editRoute({ headers: Object.fromEntries(entries) });
                              }}
                            />
                            <input
                              aria-label={`响应头值 ${i + 1}`}
                              value={value}
                              onChange={(e) =>
                                editRoute({ headers: { ...route.headers, [name]: e.target.value } })
                              }
                            />
                            {icon(
                              `删除响应头 ${i + 1}`,
                              <Trash2 size={14} />,
                              () => {
                                const next = { ...route.headers };
                                delete next[name];
                                editRoute({ headers: next });
                              },
                              busy || !!active?.running,
                            )}
                          </div>
                        ))}
                      </div>
                      <label>
                        响应内容
                        <textarea
                          aria-label="响应内容"
                          rows={5}
                          value={route.body}
                          maxLength={65536}
                          onChange={(e) => editRoute({ body: e.target.value })}
                        />
                      </label>
                      {route.mode === 'callback' && (
                        <small>
                          记录请求内容后返回以上响应；日志最多 100 条、总量 64 KiB，每条正文最多 4
                          KiB。
                        </small>
                      )}
                      {route.mode === 'code' && (
                        <>
                          <label>
                            JavaScript
                            <textarea
                              aria-label="JavaScript"
                              rows={8}
                              spellCheck={false}
                              value={route.code ?? ''}
                              maxLength={65536}
                              onChange={(e) => editRoute({ code: e.target.value })}
                            />
                          </label>
                          <small>
                            读取 request.method / path / query / headers / body；返回字符串或{' '}
                            {'{ status, headers, body }'}。每次请求使用独立进程，最多运行 5 秒。
                          </small>
                        </>
                      )}
                    </div>
                  )}
                </fieldset>
                {draft.routes.some((r) => r.mode === 'code') && !active?.running && (
                  <label className="hosting-check hosting-code-consent">
                    <input
                      type="checkbox"
                      checked={allowCode}
                      disabled={busy || dirty}
                      onChange={(e) => setAllowCode(e.target.checked)}
                    />
                    我已审查已保存代码，允许以此 Agent 的系统用户权限执行。独立进程不是权限沙箱。
                  </label>
                )}
                {active?.running && <p className="hosting-hint">停止服务后可修改配置。</p>}
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
