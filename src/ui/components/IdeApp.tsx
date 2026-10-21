import { useEffect, useState } from 'react';
import { Code2, Folder, Globe, Square, Download } from 'lucide-react';
import type { AgentCall } from '../../shared/agent';
export function IdeApp({
  call,
  openBrowser,
}: {
  call: (method: AgentCall['method'], params?: unknown) => Promise<unknown>;
  openBrowser: (url: string) => Promise<void>;
}) {
  const [state, setState] = useState<any>(),
    [plan, setPlan] = useState<any>(),
    [directory, setDirectory] = useState(''),
    [cwd, setCwd] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const refresh = async () => {
    const v = (await call('ide.status')) as any;
    setState(v);
    if (v.installError) setError(v.installError);
    setDirectory((p) => p || v.directory);
    if (v.running) setCwd(v.running.cwd);
  };
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void run(refresh);
  }, [call]);
  useEffect(() => {
    if (!state?.installing) return;
    const timer = setInterval(() => void refresh().catch((e) => setError(String(e))), 2500);
    return () => clearInterval(timer);
  }, [state?.installing, call]);
  return (
    <section className="ide-app">
      {state?.installing&&<button onClick={()=>void run(()=>call('ide.cancel'))}>取消安装</button>}
      <header>
        <span className="ide-mark">
          <Code2 size={30} />
        </span>
        <div>
          <h2>代码工作室</h2>
          <p>code-server · 项目在当前机器运行</p>
        </div>
      </header>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {state?.ready ? (
        <>
          <label>
            项目目录
            <div className="ide-path">
              <Folder size={18} />
              <input
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
                placeholder="/data/projects/my-app"
                disabled={busy || !!state.running}
              />
            </div>
          </label>
          <div className="ide-actions">
            <button
              className="primary"
              disabled={busy || !cwd}
              onClick={() =>
                void run(async () => {
                  const v = state.running || (await call('ide.start', { cwd }));
                  setState((s: any) => ({ ...s, running: v }));
                  await openBrowser(v.url);
                })
              }
            >
              <Globe size={16} />
              打开 IDE
            </button>
            {state.running && (
              <button disabled={busy} onClick={() => void run(() => call('ide.stop'))}>
                <Square size={16} />
                停止
              </button>
            )}
          </div>
          {state.running && (
            <div className="ide-access">
              <strong>本次访问密码</strong>
              <p>在 IDE 登录页粘贴。停止后密码失效。</p>
              <input
                readOnly
                value={state.running.password}
                onFocus={(e) => e.target.select()}
                aria-label="本次 IDE 访问密码"
              />
            </div>
          )}
          <small>{state.version}</small>
        </>
      ) : (
        <>
          <p>安装独立运行时与编辑器，扩展和配置放入同一专用目录。</p>
          <label>
            安装目录
            <input
              value={directory}
              onChange={(e) => {
                setDirectory(e.target.value);
                setPlan(undefined);
              }}
              disabled={busy}
            />
          </label>
          <button
            disabled={busy || !state?.supported}
            onClick={() => void run(async () => setPlan(await call('ide.plan', { directory })))}
          >
            <Download size={16} />
            检查安装计划
          </button>
          {state && !state.supported && (
            <p>此机器暂不支持独立安装包；Windows 可连接真实 WSL 环境使用。</p>
          )}
          {plan && (
            <div className="ide-plan">
              <strong>code-server {plan.version}</strong>
              <p>{plan.directory}</p>
              <ul>
                {plan.steps.map((s: string) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
              <button
                className="primary"
                disabled={busy || state?.installing}
                onClick={() => void run(() => call('ide.install', { id: plan.id, confirm: true }))}
              >
                {busy || state?.installing ? '正在安装…' : '安装'}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
