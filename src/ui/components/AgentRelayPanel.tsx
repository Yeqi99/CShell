import { useEffect, useRef, useState } from 'react';
import { Copy, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { AgentCall } from '../../shared/agent';
import {
  agentRelayConfigSchema,
  type AgentRelayConfig,
  type AgentRelayStatus,
  type AgentReverseRelayStatus,
} from '../../shared/agent-relay';
import './agent-relay-panel.css';

type Props = {
  call: (method: AgentCall['method'], params?: unknown) => Promise<any>;
  target: string;
};
const loopback = (host: string) => ['127.0.0.1', '::1', 'localhost'].includes(host.toLowerCase());

/** Keying the inner editor prevents drafts and pending responses from crossing machine boundaries. */
export function AgentRelayPanel(props: Props) {
  return <RelayModes key={props.target} {...props} />;
}
function RelayModes(props: Props) {
  const [mode, setMode] = useState<'accept' | 'outbound'>('accept');
  return (
    <div className="agent-relay-panel">
      <div role="tablist" aria-label="中继配置模式" className="agent-relay-actions">
        <button role="tab" aria-selected={mode === 'accept'} onClick={() => setMode('accept')}>
          接收转发
        </button>
        <button role="tab" aria-selected={mode === 'outbound'} onClick={() => setMode('outbound')}>
          出站连接
        </button>
      </div>
      <div hidden={mode !== 'accept'}>
        <RelayEditor {...props} />
      </div>
      <div hidden={mode !== 'outbound'}>
        <ReverseEditor {...props} />
      </div>
    </div>
  );
}

function RelayEditor({ call, target }: Props) {
  const [status, setStatus] = useState<AgentRelayStatus>();
  const [draft, setDraft] = useState<AgentRelayConfig>();
  const [external, setExternal] = useState(false);
  const [connectionHost, setConnectionHost] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [confirm, setConfirm] = useState<'save' | 'stop' | 'rotate' | 'registration' | null>(null);
  const [registrationTarget, setRegistrationTarget] = useState('');
  const alive = useRef(true);
  const currentCall = useRef(call);
  currentCall.current = call;
  useEffect(() => {
    alive.current = true;
    void call('relay.status')
      .then((result: AgentRelayStatus) => {
        if (!alive.current) return;
        setStatus(result);
        setDraft(result.config);
        setExternal(!loopback(result.config.bind));
        setConnectionHost(['0.0.0.0', '::'].includes(result.config.bind) ? '' : result.config.bind);
      })
      .catch((reason: Error) => {
        if (alive.current) setError(reason.message);
      });
    const timer = setInterval(() => {
      void currentCall
        .current('relay.status')
        .then((result: AgentRelayStatus) => {
          if (alive.current) setStatus(result);
        })
        .catch(() => {});
    }, 5000);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
    // target is the component key; call may be recreated on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setMessage('');
    setConfirm(null);
    try {
      await work();
    } catch (reason) {
      if (alive.current) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const refresh = async () => {
    const result = (await call('relay.status')) as AgentRelayStatus;
    if (alive.current) {
      setStatus(result);
      if (!draft) {
        setDraft(result.config);
        setExternal(!loopback(result.config.bind));
        setConnectionHost(['0.0.0.0', '::'].includes(result.config.bind) ? '' : result.config.bind);
      }
    }
    return result;
  };
  const update = (value: Partial<AgentRelayConfig>) => {
    setDraft((previous) => previous && { ...previous, ...value });
    setConfirm(null);
  };
  const act = (action: 'save' | 'stop' | 'rotate' | 'registration', confirmed = false) => {
    if (
      !confirmed &&
      (action === 'rotate' || action === 'registration' || !!status?.activeConnections)
    ) {
      setConfirm(action);
      return;
    }
    void run(async () => {
      if (action === 'save') {
        const config = agentRelayConfigSchema.parse(draft);
        if (!external && !loopback(config.bind)) throw new Error('对外监听需要勾选“允许对外监听”');
        await call('relay.configure', config);
        const result = await refresh();
        if (alive.current) {
          setDraft(result.config);
          setMessage('已保存；需要使用时再启动中继。');
        }
      } else {
        await call(
          action === 'stop'
            ? 'relay.stop'
            : action === 'registration'
              ? 'relay.rotateRegistrationCredential'
              : 'relay.rotateCredential',
          action === 'registration' ? { targetId: registrationTarget } : undefined,
        );
        await refresh();
        if (alive.current)
          setMessage(action === 'stop' ? '中继已停止。' : '凭证已重新生成，旧凭证已失效。');
      }
    });
  };
  const dirty = !!draft && !!status && JSON.stringify(draft) !== JSON.stringify(status.config);
  return (
    <section className="agent-relay-panel" aria-label="Agent 中继设置">
      <header className="agent-relay-heading">
        <div>
          <strong>连接中继</strong>
          <small>配置目标：{target}</small>
        </div>
        <span role="status">
          {status
            ? status.running
              ? `运行中 · ${status.activeConnections} 个连接`
              : '已停止'
            : '正在读取…'}
        </span>
        <button
          className="icon"
          title="刷新中继状态"
          aria-label="刷新中继状态"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await refresh();
            })
          }
        >
          <RefreshCw size={16} />
        </button>
      </header>
      {error && (
        <p className="agent-relay-error" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {draft && status && (
        <>
          <fieldset disabled={busy}>
            <label className="agent-relay-check">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(event) => update({ enabled: event.target.checked })}
              />
              允许使用中继
            </label>
            <div className="agent-relay-fields">
              <label>
                监听地址
                <input
                  aria-label="中继监听地址"
                  value={draft.bind}
                  onChange={(event) => update({ bind: event.target.value })}
                />
              </label>
              <label>
                监听端口
                <input
                  aria-label="中继监听端口"
                  type="number"
                  min={1}
                  max={65535}
                  value={draft.port}
                  onChange={(event) => update({ port: Number(event.target.value) })}
                />
              </label>
            </div>
            <label className="agent-relay-check">
              <input
                type="checkbox"
                checked={external}
                onChange={(event) => {
                  setExternal(event.target.checked);
                  if (!event.target.checked) update({ bind: '127.0.0.1' });
                }}
              />
              允许对外监听
            </label>
            <p className="agent-relay-note">仅转发下列目标的加密连接；受控端仍需单独授权。</p>
            <div className="agent-relay-heading">
              <strong>允许转发的目标</strong>
              <button
                className="icon"
                title="添加中继目标"
                aria-label="添加中继目标"
                disabled={draft.targets.length >= 100}
                onClick={() =>
                  update({
                    targets: [
                      ...draft.targets,
                      { id: crypto.randomUUID(), mode: 'reverse', host: '', port: 22443 },
                    ],
                  })
                }
              >
                <Plus size={16} />
              </button>
            </div>
            {!draft.targets.length && (
              <p className="agent-relay-note">尚未添加目标，当前不会转发任何连接。</p>
            )}
            {draft.targets.map((item, index) => (
              <div className="agent-relay-target" key={index}>
                <label>
                  目标标识
                  <input
                    aria-label={`中继目标 ${index + 1} 标识`}
                    value={item.id}
                    onChange={(event) =>
                      update({
                        targets: draft.targets.map((entry, i) =>
                          i === index ? { ...entry, id: event.target.value } : entry,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  接入方式
                  <select
                    aria-label={`中继目标 ${index + 1} 接入方式`}
                    value={item.mode}
                    onChange={(event) =>
                      update({
                        targets: draft.targets.map((entry, i) =>
                          i === index
                            ? { ...entry, mode: event.target.value as 'forward' | 'reverse' }
                            : entry,
                        ),
                      })
                    }
                  >
                    <option value="reverse">目标主动连接</option>
                    <option value="forward">中继直接连接</option>
                  </select>
                </label>
                {item.mode === 'forward' && (
                  <>
                    <label>
                      地址
                      <input
                        aria-label={`中继目标 ${index + 1} 地址`}
                        value={item.host}
                        onChange={(event) =>
                          update({
                            targets: draft.targets.map((entry, i) =>
                              i === index ? { ...entry, host: event.target.value } : entry,
                            ),
                          })
                        }
                      />
                    </label>
                  </>
                )}
                {item.mode === 'reverse' && (
                  <div className="agent-relay-registration">
                    <span>
                      {status.registeredTargets?.includes(item.id) ? '已连接' : '等待目标连接'}
                    </span>
                    <button
                      disabled={dirty}
                      title="单独复制此目标的注册凭证"
                      onClick={() =>
                        void run(async () => {
                          const value = await call('relay.registrationCredential', {
                            targetId: item.id,
                          });
                          if (!alive.current) return;
                          if (typeof value !== 'string') throw new Error('凭证响应无效');
                          await window.cshell.copyText(value);
                          if (alive.current) setMessage('目标注册凭证已复制。');
                        })
                      }
                    >
                      复制注册凭证
                    </button>
                    <button
                      disabled={dirty}
                      onClick={() => {
                        setRegistrationTarget(item.id);
                        act('registration');
                      }}
                    >
                      重新生成
                    </button>
                  </div>
                )}
                {item.mode === 'forward' && (
                  <label>
                    端口
                    <input
                      aria-label={`中继目标 ${index + 1} 端口`}
                      type="number"
                      min={1}
                      max={65535}
                      value={item.port}
                      onChange={(event) =>
                        update({
                          targets: draft.targets.map((entry, i) =>
                            i === index ? { ...entry, port: Number(event.target.value) } : entry,
                          ),
                        })
                      }
                    />
                  </label>
                )}
                <button
                  className="icon"
                  title={`删除目标 ${item.id}`}
                  aria-label={`删除中继目标 ${index + 1}`}
                  onClick={() => update({ targets: draft.targets.filter((_, i) => i !== index) })}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            <details>
              <summary>连接与流量限制</summary>
              <div className="agent-relay-fields">
                <label>
                  最多连接数
                  <input
                    type="number"
                    min={1}
                    max={128}
                    value={draft.maxConnections}
                    onChange={(event) => update({ maxConnections: Number(event.target.value) })}
                  />
                </label>
                <label>
                  每条连接总流量（MiB）
                  <input
                    type="number"
                    min={0.001}
                    step="any"
                    value={draft.maxBytesPerTunnel / 1048576}
                    onChange={(event) =>
                      update({
                        maxBytesPerTunnel: Math.round(Number(event.target.value) * 1048576),
                      })
                    }
                  />
                </label>
                <label>
                  每条连接速率（MiB/秒）
                  <input
                    type="number"
                    min={0.001}
                    step="any"
                    value={draft.bytesPerSecond / 1048576}
                    onChange={(event) =>
                      update({ bytesPerSecond: Math.round(Number(event.target.value) * 1048576) })
                    }
                  />
                </label>
                <label>
                  空闲断开（秒）
                  <input
                    type="number"
                    min={0.1}
                    max={3600}
                    step="any"
                    value={draft.idleTimeoutMs / 1000}
                    onChange={(event) =>
                      update({ idleTimeoutMs: Math.round(Number(event.target.value) * 1000) })
                    }
                  />
                </label>
                <label>
                  连接超时（秒）
                  <input
                    type="number"
                    min={0.1}
                    max={60}
                    step="any"
                    value={draft.connectTimeoutMs / 1000}
                    onChange={(event) =>
                      update({ connectTimeoutMs: Math.round(Number(event.target.value) * 1000) })
                    }
                  />
                </label>
              </div>
            </details>
            <div className="agent-relay-actions">
              <button className="primary" disabled={!dirty} onClick={() => act('save')}>
                保存配置
              </button>
              {status.running ? (
                <button onClick={() => act('stop')}>停止中继</button>
              ) : (
                <button
                  disabled={!status.config.enabled || dirty}
                  title={dirty ? '先保存配置' : undefined}
                  onClick={() =>
                    void run(async () => {
                      await call('relay.start');
                      await refresh();
                    })
                  }
                >
                  启动中继
                </button>
              )}
              {busy && <span role="status">正在处理…</span>}
            </div>
            <div className="agent-relay-sharing">
              <label>
                供连接方使用的地址
                <input
                  aria-label="中继连接地址"
                  placeholder="可达的 IP 或域名"
                  value={connectionHost}
                  onChange={(event) => setConnectionHost(event.target.value)}
                />
              </label>
              <button
                title="复制地址、端口和身份指纹，不含凭证"
                onClick={() =>
                  void run(async () => {
                    if (
                      !connectionHost.trim() ||
                      /[\s/\\]/.test(connectionHost) ||
                      ['0.0.0.0', '::'].includes(connectionHost)
                    )
                      throw new Error('请填写连接方可达的 IP 或域名');
                    await window.cshell.copyText(
                      JSON.stringify({
                        protocol: 'cshell-relay/1',
                        host: connectionHost.trim(),
                        port: status.config.port,
                        fingerprint: status.fingerprint,
                      }),
                    );
                    if (alive.current) setMessage('连接信息已复制，不含凭证。');
                  })
                }
              >
                <Copy size={14} />
                复制连接信息
              </button>
              <button
                title="单独复制中继凭证"
                onClick={() =>
                  void run(async () => {
                    const credential = await call('relay.revealCredential');
                    if (!alive.current) return;
                    if (typeof credential !== 'string') throw new Error('凭证响应无效');
                    await window.cshell.copyText(credential);
                    if (alive.current) setMessage('凭证已复制。');
                  })
                }
              >
                复制转发凭证
              </button>
              <button onClick={() => act('rotate')}>重新生成凭证</button>
            </div>
          </fieldset>
          {confirm && (
            <div className="agent-relay-confirm" role="alert">
              <span>
                {confirm === 'rotate' || confirm === 'registration'
                  ? '旧凭证会立即失效，正在转发的连接会断开。'
                  : `此操作将断开 ${status.activeConnections} 个正在转发的连接。`}
              </span>
              <button disabled={busy} onClick={() => act(confirm, true)}>
                确认{confirm === 'save' ? '保存' : confirm === 'stop' ? '停止' : '重新生成'}
              </button>
              <button onClick={() => setConfirm(null)}>取消</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function ReverseEditor({ call, target }: Props) {
  type Draft = {
    enabled: boolean;
    host: string;
    port: number;
    fingerprint: string;
    targetId: string;
    credential: string;
    localHost: '127.0.0.1' | '::1';
    localPort: number;
    maxConnections: number;
    connectTimeoutMs: number;
  };
  const [status, setStatus] = useState<AgentReverseRelayStatus>();
  const [draft, setDraft] = useState<Draft>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const [confirm, setConfirm] = useState<'save' | 'stop' | null>(null);
  const alive = useRef(true),
    callRef = useRef(call);
  callRef.current = call;
  const fromStatus = (result: AgentReverseRelayStatus): Draft => ({
    enabled: result.config.enabled,
    host: result.config.relay?.host ?? '',
    port: result.config.relay?.port ?? 22444,
    fingerprint: result.config.relay?.fingerprint ?? '',
    targetId: result.config.relay?.targetId ?? '',
    credential: '',
    localHost: result.config.localHost,
    localPort: result.config.localPort,
    maxConnections: result.config.maxConnections,
    connectTimeoutMs: result.config.connectTimeoutMs,
  });
  useEffect(() => {
    alive.current = true;
    void call('relay.reverse.status')
      .then((result: AgentReverseRelayStatus) => {
        if (alive.current) {
          setStatus(result);
          setDraft(fromStatus(result));
        }
      })
      .catch((reason: Error) => {
        if (alive.current) setError(reason.message);
      });
    const timer = setInterval(() => {
      void callRef
        .current('relay.reverse.status')
        .then((result: AgentReverseRelayStatus) => {
          if (alive.current) setStatus(result);
        })
        .catch(() => {});
    }, 3000);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, []);
  const dirty = !!draft && !!status && JSON.stringify(draft) !== JSON.stringify(fromStatus(status));
  const update = (value: Partial<Draft>) => {
    setDraft((previous) => previous && { ...previous, ...value });
    setConfirm(null);
  };
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setMessage('');
    setConfirm(null);
    try {
      await work();
    } catch (reason) {
      if (alive.current) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const refresh = async () => {
    const result = (await call('relay.reverse.status')) as AgentReverseRelayStatus;
    if (alive.current) {
      setStatus(result);
      if (!draft) setDraft(fromStatus(result));
    }
    return result;
  };
  const act = (action: 'save' | 'stop', confirmed = false) => {
    if (!confirmed && status?.running) {
      setConfirm(action);
      return;
    }
    void run(async () => {
      if (action === 'save' && draft) {
        const { host, port, fingerprint, targetId, credential, ...rest } = draft;
        const relay =
          host || fingerprint || targetId || credential
            ? { host, port, fingerprint, targetId, credential }
            : undefined;
        await call('relay.reverse.configure', { ...rest, relay });
        const result = await refresh();
        if (alive.current) {
          setDraft(fromStatus(result));
          setMessage('已保存，点击连接后开始出站连接。');
        }
      } else {
        await call('relay.reverse.stop');
        await refresh();
        if (alive.current) setMessage('出站连接已停止。');
      }
    });
  };
  return (
    <section className="agent-relay-panel" aria-label="Agent 出站中继设置">
      <header className="agent-relay-heading">
        <div>
          <strong>连接到中继</strong>
          <small>配置目标：{target}</small>
        </div>
        <span role="status">
          {status
            ? status.connected
              ? '已连接'
              : status.running
                ? '正在重连…'
                : '已停止'
            : '正在读取…'}
        </span>
        <button
          className="icon"
          title="刷新出站连接状态"
          aria-label="刷新出站连接状态"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await refresh();
            })
          }
        >
          <RefreshCw size={16} />
        </button>
      </header>
      <p className="agent-relay-note">此 Agent 主动连接中继，无需为此 Agent 开放公网端口。</p>
      {(error || status?.error) && (
        <p className="agent-relay-error" role="alert">
          {error || status?.error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {draft && status && (
        <>
          <fieldset disabled={busy}>
            <label className="agent-relay-check">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(event) => update({ enabled: event.target.checked })}
              />
              允许出站中继
            </label>
            <div className="agent-relay-fields">
              <label>
                中继地址
                <input
                  aria-label="出站中继地址"
                  value={draft.host}
                  onChange={(event) => update({ host: event.target.value })}
                />
              </label>
              <label>
                中继端口
                <input
                  aria-label="出站中继端口"
                  type="number"
                  min={1}
                  max={65535}
                  value={draft.port}
                  onChange={(event) => update({ port: Number(event.target.value) })}
                />
              </label>
            </div>
            <label>
              中继身份指纹
              <input
                aria-label="出站中继身份指纹"
                value={draft.fingerprint}
                onChange={(event) => update({ fingerprint: event.target.value })}
              />
            </label>
            <div className="agent-relay-fields">
              <label>
                目标标识
                <input
                  aria-label="出站中继目标标识"
                  value={draft.targetId}
                  onChange={(event) => update({ targetId: event.target.value })}
                />
              </label>
              <label>
                目标注册凭证
                <input
                  aria-label="出站中继注册凭证"
                  type="password"
                  autoComplete="new-password"
                  placeholder={
                    status.config.hasCredential ? '已保存；留空保留' : '粘贴此目标的注册凭证'
                  }
                  value={draft.credential}
                  onChange={(event) => update({ credential: event.target.value })}
                />
              </label>
            </div>
            <details>
              <summary>本机 Agent 与连接限制</summary>
              <div className="agent-relay-fields">
                <label>
                  本机 Agent 地址
                  <select
                    aria-label="出站中继本机地址"
                    value={draft.localHost}
                    onChange={(event) =>
                      update({ localHost: event.target.value as Draft['localHost'] })
                    }
                  >
                    <option value="127.0.0.1">127.0.0.1</option>
                    <option value="::1">::1</option>
                  </select>
                </label>
                <label>
                  本机 Agent 端口
                  <input
                    aria-label="出站中继本机端口"
                    type="number"
                    min={1}
                    max={65535}
                    value={draft.localPort}
                    onChange={(event) => update({ localPort: Number(event.target.value) })}
                  />
                </label>
                <label>
                  最多连接数
                  <input
                    type="number"
                    min={1}
                    max={128}
                    value={draft.maxConnections}
                    onChange={(event) => update({ maxConnections: Number(event.target.value) })}
                  />
                </label>
                <label>
                  连接超时（秒）
                  <input
                    type="number"
                    min={0.1}
                    max={60}
                    step="any"
                    value={draft.connectTimeoutMs / 1000}
                    onChange={(event) =>
                      update({ connectTimeoutMs: Math.round(Number(event.target.value) * 1000) })
                    }
                  />
                </label>
              </div>
            </details>
            <div className="agent-relay-actions">
              <button className="primary" disabled={!dirty} onClick={() => act('save')}>
                保存出站配置
              </button>
              {status.running ? (
                <button onClick={() => act('stop')}>停止出站连接</button>
              ) : (
                <button
                  disabled={dirty || !status.config.enabled}
                  onClick={() =>
                    void run(async () => {
                      await call('relay.reverse.start');
                      await refresh();
                    })
                  }
                >
                  连接中继
                </button>
              )}
              {busy && <span role="status">正在处理…</span>}
            </div>
          </fieldset>
          {confirm && (
            <div className="agent-relay-confirm" role="alert">
              <span>此操作会断开中继以及经由它建立的 {status.activeConnections} 个连接。</span>
              <button onClick={() => act(confirm, true)}>
                确认{confirm === 'save' ? '保存' : '停止'}
              </button>
              <button onClick={() => setConfirm(null)}>取消</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
