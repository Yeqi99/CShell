import { ErrorNotice } from './ErrorNotice';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Monitor, Terminal, ChevronRight, RefreshCw } from 'lucide-react';
import type { AgentCall } from '../../shared/agent';
import type { LinuxWorkspacePlan } from '../../shared/linux-workspace';
import type { RemoteJob } from '../../shared/plugins';
import { LinuxDesktop, LinuxDesktopTerminal } from './LinuxDesktop';
import type { Preferences } from '../../shared/contracts';
import './linux-workspace.css';

export function LinuxWorkspace({
  session,
  name,
  active,
  closed,
  onTerminal,
  profileId,
  preferences, terminal, files, onRetry,
}: {
  terminal?: (active: boolean, theme: 'light' | 'dark') => ReactNode;
  files?: ReactNode | ((active: boolean) => ReactNode);
  onRetry?: () => void;
  profileId: string;
  preferences: Preferences;
  session: string;
  name: string;
  active: boolean;
  closed: boolean;
  onTerminal: () => void;
}) {
  const [plan, setPlan] = useState<LinuxWorkspacePlan>(),
    [directory, setDirectory] = useState(''),
    [job, setJob] = useState<RemoteJob>(),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(''),
    [machine, setMachine] = useState<any>();
  const target = 'ssh:' + session;
  const call = useCallback(
    (method: AgentCall['method'], params?: unknown) =>
      window.cshell.agentCall(target, { method, params }),
    [target],
  );
  const inspect = async () => {
    if (closed) return;
    setBusy(true);
    setError('');
    try {
      setPlan(undefined);
      const p = await window.cshell.linuxWorkspacePlan(session, directory.trim() || undefined);
      setPlan(p);
      setDirectory(p.installDirectory);
      if (p.installed) {
        try {
          setMachine(await call('client.status'));
          setReady(true);
        } catch (e) {
          setError(String(e));
          setReady(false);
        }
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void inspect();
  }, [session]);
  useEffect(() => {
    if (job?.state !== 'running' || closed) return;
    let cancelled = false;
    const timer = setInterval(() => {
      void window.cshell
        .linuxWorkspaceJob(session, job.id)
        .then(async (next) => {
          if (cancelled) return;
          setJob(next);
          if (next.state === 'succeeded') await inspect();
        })
        .catch((e) => {
          if (!cancelled) setError(String(e));
        });
    }, 1200);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [job?.id, job?.state, closed]);
  const install = async () => {
    if (!plan || closed || busy) return;
    setBusy(true); setError('');
    try {const result=await window.cshell.linuxWorkspaceInstall(session,plan.id);setJob(result);if(result.state==='succeeded')await inspect();}
    catch(e){setError(String(e));}finally{setBusy(false);}
  };
  const setup = (
    <section className="linux-workspace" aria-label="Linux 可视化工作区" hidden={!active}>
      <header className="linux-topbar">
        <button title="工作区首页" aria-label="工作区首页" onClick={() => void inspect()}>
          <Monitor size={20} />
        </button>
        <div>
          <strong>{name}</strong>
          <small>{ready ? 'Linux · CAgent over SSH' : 'Linux 工作区'}</small>
        </div>
        <span className={'linux-state ' + (ready && !closed ? 'online' : '')}>
          {closed ? '已断开' : ready ? '已连接' : '待配置'}
        </span>
        <div className="linux-topbar-spacer" />
        <button
          title="检查状态"
          aria-label="检查状态"
          disabled={closed || busy}
          onClick={() => void inspect()}
        >
          <RefreshCw size={16} />
        </button>
        <button onClick={onTerminal}>
          <Terminal size={16} /> SSH 终端
        </button>
      </header>
      {closed ? (
        <div className="linux-empty">
          <h2>连接已断开</h2>
          <p>重新连接这台机器后可恢复工作区。</p>
        </div>
      ) : (
        <>
          {error && (
            <ErrorNotice title="工作区操作未完成" error={error} />
          )}
          {!ready ? (
            <div className="linux-setup">

              <h1>安装 CAgent</h1>
              <p>选择这台机器上的安装位置，检查后开始安装。</p>
              {!plan?.installed && (
                <label>
                  安装目录
                  <input
                    aria-label="CAgent 安装目录"
                    placeholder="留空使用用户目录，例如 /data/cagent"
                    value={directory}
                    disabled={busy || job?.state === 'running'}
                    onChange={(e) => {
                      setDirectory(e.target.value);
                      setPlan(undefined);
                    }}
                  />
                  <button
                    disabled={busy || job?.state === 'running'}
                    onClick={() => void inspect()}
                  >
                    检查目录与安装计划
                  </button>
                </label>
              )}
              {busy && <p role="status">正在检查…</p>}
              {plan && (
                <div className="linux-plan">
                  <h3>
                    {plan.user} · {plan.platform} {plan.arch}
                  </h3>
                  <p>目录：{plan.installDirectory}</p>
                  <pre aria-label="目标磁盘空间">{plan.diskInfo}</pre>
                  <ol>
                    {plan.steps.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ol>
                  <button
                    disabled={busy || job?.state === 'running'}
                    onClick={() => void install()}
                  >
                    {plan.installed ? '启动并连接 CAgent' : '安装并连接 CAgent'}
                    <ChevronRight size={16} />
                  </button>
                </div>
              )}
              {job && (
                <div role="status">
                  <strong>
                    {job.label} · {job.state}
                  </strong>
                  <pre>{job.output}</pre>
                  {job.state === 'running' && (
                    <button
                      onClick={() =>
                        void window.cshell.linuxWorkspaceJob(session, job.id, true).then(setJob)
                      }
                    >
                      取消安装
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
  return <div className="linux-desktop-host" hidden={!active}>
    <LinuxDesktop name={name} machine={ready ? {...machine, deviceId: profileId} : {deviceId:profileId, platform:plan?.platform || 'unknown', sshOnly:true}} target={target} call={call} active={active} closed={closed} onRetry={onRetry} onTerminal={onTerminal}
      files={files} terminal={terminal || ((visible,theme)=><LinuxDesktopTerminal profileId={profileId} preferences={{...preferences,theme}} active={visible}/>)}
      extraPanels={ready ? [] : [{id:'install-cagent',label:'安装 CAgent',content:setup}]}/>
  </div>;

}
