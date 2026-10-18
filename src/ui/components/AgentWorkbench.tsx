import { AgentAssistantSettings } from './AgentAssistantSettings';
import { AgentApplications } from './AgentApplications';
import { useCallback, useEffect, useState } from 'react';
import type { AgentCall, AgentShellOption, AgentTarget } from '../../shared/agent';
import type { ClientStatus, ClientShell } from '../../shared/client';
import { AgentHostingPanel } from './AgentHostingPanel';
import { AgentRelayPanel } from './AgentRelayPanel';
import { AgentWslNetwork } from './AgentWslNetwork';
import './agent-workbench.css';
type Status = ClientStatus & { autostart?: {supported:boolean;enabled:boolean}; platform?: string; canImportLegacy?: boolean };
export function AgentWorkbench() {
  const [targets, setTargets] = useState<AgentTarget[]>([]),
    [target, setTarget] = useState('local'),
    [error, setError] = useState(''),
    [launching, setLaunching] = useState(false),
    [launchMessage, setLaunchMessage] = useState('');
  const refresh = () =>
    window.cshell
      .agentTargets()
      .then(setTargets)
      .catch((e) => setError(String(e)));
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, []);
  const current = targets.find((t) => t.id === target);
  return (
    <div className="agent-workbench">
      <div className="agent-toolbar">
        <label>
          配置目标
          <select
            aria-label="Agent 配置目标"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          >
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <button onClick={() => void refresh()}>刷新</button>
        {current?.local && current.bundledApp && (
          <button disabled={launching} onClick={async () => {
            setLaunching(true); setError(''); setLaunchMessage('');
            try { await window.cshell.agentLaunch(); setLaunchMessage('已请求打开 cagent；已有后台继续使用原会话。'); await refresh(); }
            catch (e) { setError(String(e)); }
            finally { setLaunching(false); }
          }}>{launching ? '正在打开…' : '打开本机 cagent'}</button>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {launchMessage && <p role="status">{launchMessage}</p>}
      {current?.available ? (
        <AgentConfiguration key={target} target={current} />
      ) : (
        <div className="agent-empty">
          <h2>{current?.reason ?? '目标已断开'}</h2>
          <p>{current?.bundledApp ? '点击“打开本机 cagent”启动独立应用，再在这里配置连接与权限。' : '安装并启动独立 Agent 后，可在这里配置。'}发现服务不会自动开放远程访问。</p>
          <button
            onClick={() =>
              void window.cshell.clientDownloadPage().catch((e) => setError(String(e)))
            }
          >
            下载 Agent
          </button>
        </div>
      )}
    </div>
  );
}
export function AgentConfiguration({ target, machine=false }: { target: AgentTarget; machine?:boolean }) {
  const [section, setSection] = useState('connection');
  const [visited, setVisited] = useState<string[]>(['connection']);
  const call = useCallback(
    (method: AgentCall['method'], params?: unknown) =>
      window.cshell.agentCall(target.id, { method, params }),
    [target.id],
  );
  return (
    <>
      <nav className="agent-tabs" aria-label="Agent 配置分类">
        {[
          ['connection', '连接与权限'],
          ['assistant', '模型与智能体'],
          ['applications', '应用市场'],
          ['hosting', 'HTTP 服务'],
          ['relay', '中继'],
          ['wsl', 'WSL'],
          ['logs', '日志'],
        ].filter(([id])=>!machine||id!=='applications').map(([id, label]) => (
          <button
            key={id}
            aria-selected={section === id}
            onClick={() => {
              setSection(id);
              setVisited((v) => (v.includes(id) ? v : [...v, id]));
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      <div hidden={section !== 'connection'}>
        <AgentConnection target={target} call={call} />
      </div>
      <div hidden={section !== 'assistant'}>{visited.includes('assistant')&&<AgentAssistantSettings call={call}/>}</div>
      <div hidden={section !== 'applications'}>{visited.includes('applications')&&<AgentApplications target={target} call={call}/>}</div>
      <div hidden={section !== 'hosting'}>
        {visited.includes('hosting') && <AgentHostingPanel target={target.id} call={call} />}
      </div>
      <div hidden={section !== 'relay'}>
        {visited.includes('relay') && <AgentRelayPanel target={target.id} call={call} />}
      </div>
      <div hidden={section !== 'wsl'}>
        {visited.includes('wsl') && <AgentWsl target={target.id} call={call} />}
      </div>
      {section === 'logs' && <AgentLogs call={call} />}
    </>
  );
}
type Call = (method: AgentCall['method'], params?: unknown) => Promise<any>;
function AgentConnection({ target, call }: { target: AgentTarget; call: Call }) {
  const [status, setStatus] = useState<Status>(),
    [shells, setShells] = useState<AgentShellOption[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''), [loaded,setLoaded]=useState(false);
  const [bind, setBind] = useState('0.0.0.0'),
    [port, setPort] = useState(47831),
    [publicPort, setPublicPort] = useState(''),
    [host, setHost] = useState('127.0.0.1'),
    [password, setPassword] = useState(''),
    [grants, setGrants] = useState<ClientShell[]>([]);
  const [access, setAccess] = useState({
      allowHttp: false,
      allowManage: false,
      allowHosting: false,
      allowRelay: false,
    }),
    [confirm, setConfirm] = useState(false);
  const refresh = async () => {
    const s = (await call('client.status')) as Status;
    setStatus(previous => ({...previous, ...s}));
    return s;
  };
  useEffect(() => {
    let alive = true;
    const timer = setInterval(() => {
      void call('client.status')
        .then((s) => alive && setStatus(previous => ({...previous, ...s})))
        .catch((e) => alive && setError(String(e)));
    }, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [call]);
  useEffect(() => {
    let alive = true;
    void Promise.all([call('connection.settings'), call('agent.environments')])
      .then(([s, choices]) => {
        if (!alive) return;
        setLoaded(true);
        setStatus(s);
        setPassword(s.password ?? '');
        setShells(choices);
        setBind(s.bind ?? '0.0.0.0');
        setHost(s.advertisedHost ?? s.interfaces?.[0] ?? '127.0.0.1');
        setPort(s.port ?? 47831);
        setPublicPort(s.advertisedPort == null ? '' : String(s.advertisedPort));
        setGrants(s.passwordConfigured ? s.allowedShells ?? [] : [...new Set(choices.map((choice: {shell:ClientShell}) => choice.shell))] as ClientShell[]);
        setAccess({
          allowHttp: !s.passwordConfigured || !!s.allowHttp,
          allowManage: !s.passwordConfigured || !!s.allowManage,
          allowHosting: !s.passwordConfigured || !!s.allowHosting,
          allowRelay: !s.passwordConfigured || !!s.allowRelay,
        });
      })
      .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, [call]);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await fn();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const listener = { bind, port, advertisedHost: host, ...(publicPort.trim() ? {advertisedPort:Number(publicPort)} : {}) };
  const save = () =>
    run(async () => {
      const result = await call('connection.save', {...listener, password, shells:grants, ...access});
      if (result.disconnects) setMessage('正在应用连接设置；原连接会断开，请重新连接。');
      else {await refresh();setMessage('连接设置已保存。');}
      setConfirm(false);
    });
  return (
    <div className="agent-settings">{!loaded&&!error&&<p role="status">正在读取这台机器的配置…</p>}
      <p role="status">
        {status?.running ? '远程访问已启动' : '远程访问未启动'} · {target.name}
      </p>
      <fieldset disabled={busy||!loaded}>
        <div className="agent-fields">
          <label>
            监听地址
            <select value={bind} onChange={(e) => setBind(e.target.value)}>
              {[...new Set([bind, ...(status?.interfaces ?? [])])].map((ip) => (
                <option key={ip}>{ip}</option>
              ))}
            </select>
          </label>
          <label>
            端口
            <input
              type="number"
              min={1024}
              max={65535}
              value={port}
              onChange={(e) => setPort(Number(e.target.value))}
            />
          </label>
          <label>
            对外地址
            <input value={host} onChange={(e) => setHost(e.target.value)} />
          </label>
        </div>
        <label>对外端口（留空使用监听端口）<input type="number" min={1} max={65535} value={publicPort} placeholder={String(port)} onChange={e=>setPublicPort(e.target.value)}/></label>
        {status?.autostart?.supported&&<label><input type="checkbox" checked={status.autostart.enabled} onChange={e=>{const enabled=e.target.checked;void call('connection.autostart',{enabled}).then(autostart=>setStatus({...status,autostart})).catch(e=>setError(String(e)))}}/>开机自动启动</label>}
        <label>
          连接密码
          <input
            type="text"
            value={password}
            minLength={1}
            maxLength={128}
            placeholder={status?.passwordConfigured ? '留空保留现有权限与密码' : '设置连接密码'}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <div className="agent-actions">
          <button
            onClick={() =>
              setPassword(
                [...crypto.getRandomValues(new Uint8Array(24))]
                  .map((b) => b.toString(16).padStart(2, '0'))
                  .join(''),
              )
            }
          >
            生成新密码
          </button>
          <button
            disabled={!password}
            onClick={() =>
              void run(async () => {
                await window.cshell.copyText(password);
                setMessage('已复制新密码，请通过可信渠道提供。');
              })
            }
          >
            复制新密码
          </button>
        </div>
        <p>修改密码与权限会撤销已有控制端授权。</p>
        <div className="agent-checks">
          {[...new Map(shells.map((s) => [s.shell, s])).values()].map((s) => (
            <label key={s.shell}>
              <input
                type="checkbox"
                checked={grants.includes(s.shell as ClientShell)}
                onChange={(e) =>
                  setGrants(
                    e.target.checked
                      ? [...grants, s.shell as ClientShell]
                      : grants.filter((v) => v !== s.shell),
                  )
                }
              />
              {s.shell === 'wsl' ? 'WSL 已安装发行版' : s.label}
            </label>
          ))}
        </div>
        <div className="agent-checks">
          {(['allowHttp', 'allowManage', 'allowHosting', 'allowRelay'] as const).map((key, i) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={access[key]}
                onChange={(e) => setAccess({ ...access, [key]: e.target.checked })}
              />
              {
                [
                  '发送 HTTP 请求（主机）',
                  '管理 Agent 与系统环境',
                  '托管 HTTP 服务（主机）',
                  '配置中继',
                ][i]
              }
            </label>
          ))}
        </div>
        {status?.running && (
          <label className="agent-check">
            <input
              type="checkbox"
              checked={confirm}
              onChange={(e) => setConfirm(e.target.checked)}
            />
            确认重启监听并断开现有连接
          </label>
        )}
        <div className="agent-actions">
          <button
            disabled={status?.running ? !confirm : !status?.passwordConfigured && !password}
            onClick={() => void save()}
          >
            {status?.running ? '应用并重启监听' : '保存并启动'}
          </button>
          {status?.running && (
            <button
              disabled={!confirm}
              onClick={() =>
                void run(async () => {
                  await call('client.stop');
                  setMessage('已请求停止；远程连接将断开。');
                  if (target.local) await refresh();
                })
              }
            >
              停止远程访问
            </button>
          )}
          <button
            disabled={!status?.running}
            onClick={() =>
              void run(async () => {
                await window.cshell.copyText(await call('client.info', { host }));
                setMessage('已复制连接信息，不含密码。');
              })
            }
          >
            复制连接信息
          </button>
        </div>
        {target.local && status?.canImportLegacy && (
          <button
            onClick={() =>
              void run(async () => {
                await window.cshell.agentImportLegacy();
                await refresh();
                setMessage('已导入旧身份与权限，请重新进入此页。');
              })
            }
          >
            导入旧 Client 身份与授权
          </button>
        )}
      </fieldset>
      <details>
        <summary>设备身份与已授权控制端</summary>
        <code>{status?.fingerprint}</code>
        {status?.peers.map((peer) => (
          <div key={peer.fingerprint}>
            <span>
              {peer.name} · {peer.connected} 个连接
            </span>
            <button
              onClick={() =>
                void run(async () => {
                  await call('client.revoke', { fingerprint: peer.fingerprint });
                  await refresh();
                })
              }
            >
              撤销授权并断开
            </button>
          </div>
        ))}
      </details>
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
function AgentLogs({ call }: { call: Call }) {
  const [logs, setLogs] = useState<any[]>([]),
    [error, setError] = useState('');
  useEffect(() => {
    void call('agent.logs')
      .then(setLogs)
      .catch((e) => setError(String(e)));
  }, [call]);
  return (
    <div>
      <p role="alert">{error}</p>
      <pre>{logs.map((r) => `${r.time}  ${r.action}  ${r.peer}`).join('\n') || '暂无活动'}</pre>
    </div>
  );
}
function AgentWsl({ target, call }: { target: string; call: Call }) {
  const [check, setCheck] = useState<any>(),
    [plan, setPlan] = useState<any>(),
    [distribution, setDistribution] = useState(''),
    [installed, setInstalled] = useState(''),
    [user, setUser] = useState(''),
    [password, setPassword] = useState(''),
    [confirm, setConfirm] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState('');
  const run = async (fn: () => Promise<void>) => {
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
  useEffect(() => {
    void run(async () => {
      const value = await call('wsl.check');
      setCheck(value);
      setPlan(value.installation);
      setDistribution(value.online?.[0] ?? '');
      setInstalled(value.distributions?.[0] ?? '');
    });
  }, [target]);
  useEffect(() => {
    if (plan?.state !== 'running') return;
    const timer = setInterval(
      () =>
        void call('wsl.status')
          .then(setPlan)
          .catch((e) => setError(String(e))),
      1500,
    );
    return () => clearInterval(timer);
  }, [call, plan?.state]);
  return (
    <div className="agent-settings">
      {check?.supported === false ? (
        <p>此 Agent 不是 Windows，无 WSL 功能。</p>
      ) : (
        <>
          <p>操作作用于所选 Windows Agent，安装可能需要管理员权限及重启；不会自动提权或重启。</p>
          <fieldset disabled={busy}>
            <div className="agent-fields">
              <label>
                安装发行版
                <select value={distribution} onChange={(e) => setDistribution(e.target.value)}>
                  {check?.online?.map((d: string) => (
                    <option key={d}>{d}</option>
                  ))}
                </select>
              </label>
              <button
                disabled={!distribution}
                onClick={() =>
                  void run(async () => {
                    setPlan(await call('wsl.plan', { distribution }));
                    setConfirm(false);
                  })
                }
              >
                检查并生成计划
              </button>
            </div>
            {check?.onlineError && <p>{check.onlineError}</p>}
            {plan && (
              <>
                <pre>{plan.logs}</pre>
                <label className="agent-check">
                  <input
                    type="checkbox"
                    checked={confirm}
                    onChange={(e) => setConfirm(e.target.checked)}
                  />
                  确认在此 Agent 安装 {plan.distribution}
                </label>
                <button
                  disabled={!confirm || plan.state === 'running' || plan.state === 'completed'}
                  onClick={() =>
                    void run(async () =>
                      setPlan(await call('wsl.install', { planId: plan.id, confirm: true })),
                    )
                  }
                >
                  执行安装
                </button>
                {plan.state === 'running' && (
                  <button onClick={() => void run(async () => setPlan(await call('wsl.cancel')))}>
                    取消安装
                  </button>
                )}
                <p>状态：{plan.state}</p>
              </>
            )}
            <details>
              <summary>初始化 Linux 用户</summary>
              <label>
                已安装发行版
                <select value={installed} onChange={(e) => setInstalled(e.target.value)}>
                  {check?.distributions?.map((d: string) => (
                    <option key={d}>{d}</option>
                  ))}
                </select>
              </label>
              <label>
                用户名
                <input value={user} onChange={(e) => setUser(e.target.value)} />
              </label>
              <label>
                Linux 密码
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <button
                disabled={!installed || !user || !password}
                onClick={() =>
                  void run(async () => {
                    const status = await call('wsl.account.initialize', {
                      distribution: installed,
                      username: user,
                      password,
                      confirm: true,
                    });
                    setPassword('');
                    setResult(status.ready ? '默认 Linux 用户已验证' : '用户初始化未完成');
                  })
                }
              >
                创建并设为默认用户
              </button>
            </details>
          </fieldset>
          <AgentWslNetwork call={call} />
        </>
      )}
      {result && <p role="status">{result}</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
