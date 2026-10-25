import { ErrorNotice } from './ErrorNotice';
import { useEffect, useState } from 'react';
import { Code2, Download, ArrowLeft, Check, RefreshCw, ShieldCheck } from 'lucide-react';
import type { AgentCall } from '../../shared/agent';
import './development-market.css';
import { agentRead } from '../agent-read';
import { agentCapabilityError, agentCompatibilityNotice } from '../../shared/agent-compatibility';
export function DevelopmentMarket({
  call,
  onOpen,
  onChanged,
}: {
  call: (method: AgentCall['method'], params?: unknown) => Promise<unknown>;
  onOpen?: (id: string) => void;
  onChanged?: (apps?: { codex: boolean; claude: boolean; ide: boolean }) => void;
}) {
  const [coding, setCoding] = useState<any>(),
    [ide, setIde] = useState<any>(),
    [selected, setSelected] = useState(''),
    [directory, setDirectory] = useState(''),
    [plan, setPlan] = useState<any>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''), [compatibility,setCompatibility]=useState('');
  const refresh = async () => {
    const [c, i] = await Promise.allSettled([
      agentRead(() => call('coding.status')),
      agentRead(() => call('ide.status')),
    ]);
    setCoding(c.status === 'fulfilled' ? c.value : undefined);
    setIde(i.status === 'fulfilled' ? i.value : undefined);
    const failures=[c,i].filter(r=>r.status==='rejected').map(r=>agentCapabilityError(r.reason));
    setError([...new Set(failures.filter(message=>message!==agentCompatibilityNotice))].join(' '));
    const cs = c.status==='fulfilled'?c.value as any:undefined,
      editor = i.status==='fulfilled'?i.value as any:undefined;
    setCompatibility([...failures.filter(message=>message===agentCompatibilityNotice),...[cs,editor].map(v=>typeof v?.compatibility==='string'?v.compatibility:'')].filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).join(' '));
    if(c.status==='fulfilled'&&i.status==='fulfilled')onChanged?.({
      codex: !!cs?.engines?.find((e: any) => e.engine === 'codex')?.ready,
      claude: !!cs?.engines?.find((e: any) => e.engine === 'claude')?.ready,
      ide: !!editor?.supported && !!editor.ready,
    });
  };
  const run = async (fn?: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      if (fn) await fn();
      await refresh();
    } catch (e) {
      setError(agentCapabilityError(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void run();
  }, [call]);
  const installing = coding?.installs?.some((j: any) => j.state === 'running') || ide?.installing;
  useEffect(() => {
    if (!installing) return;
    let pending = false;
    const t = setInterval(() => {
      if (pending) return;
      pending = true;
      void refresh()
        .catch((e) => setError(String(e)))
        .finally(() => {
          pending = false;
        });
    }, 1500);
    return () => clearInterval(t);
  }, [installing, call]);
  const apps = [
    ...(coding?.supported
      ? [
          { id: 'codex', title: 'Codex', description: 'OpenAI 编程智能体' },
          { id: 'claude', title: 'Claude Code', description: 'Anthropic 编程智能体' },
        ]
      : []),
    ...(ide?.supported
      ? [{ id: 'ide', title: '代码编辑器', description: 'code-server · 文件、终端与扩展' }]
      : []),
  ];
  const app = apps.find((a) => a.id === selected),
    state = selected === 'ide' ? ide : coding?.engines?.find((e: any) => e.engine === selected);
  return (
    <section className="development-market">
      <header>
        <div>
          <h3>开发工具</h3>
          <p>安装到这台机器，验证完成后加入桌面。</p>
        </div>
        <button
          aria-label="刷新开发应用"
          title="刷新开发应用"
          disabled={busy}
          onClick={() => void run()}
        >
          <RefreshCw size={16} />
        </button>
      </header>
      {error && (
        <ErrorNotice title="应用操作未完成" error={error} />
      )}
      {compatibility&&<p role="status">{compatibility}</p>}
      {app ? (
        <div className="development-detail">
          <button
            className="development-back"
            onClick={() => {
              setSelected('');
              setPlan(undefined);
            }}
          >
            <ArrowLeft size={16} />
            全部开发工具
          </button>
          <div className="development-heading">
            <span>
              <Code2 size={28} />
            </span>
            <div>
              <h3>{app.title}</h3>
              <p>{state?.ready ? state.version : app.description}</p>
            </div>
            {state?.ready && onOpen && <button onClick={() => onOpen(app.id)}>打开</button>}
          </div>
          <label>
            安装位置
            <input
              value={directory}
              disabled={busy || installing}
              onChange={(e) => {
                setDirectory(e.target.value);
                setPlan(undefined);
              }}
            />
          </label>
          <div className="development-permissions">
            <ShieldCheck size={18} />
            <div>
              <strong>当前机器的应用权限</strong>
              <p>
                安装使用已授权的远程管理权限。编程任务可选择只读、编辑或执行；代码编辑器仅通过本机回环服务访问。
              </p>
            </div>
          </div>
          {selected !== 'ide' && (
            <label>
              允许的最高操作范围
              <select
                value={coding?.permissions?.[selected] ?? 'execute'}
                disabled={busy || installing}
                onChange={(e) =>
                  void run(() =>
                    call('coding.permission', { engine: selected, mode: e.target.value }),
                  )
                }
              >
                <option value="read">只读项目</option>
                <option value="edit">读取与修改文件</option>
                <option value="execute">读取、修改与执行命令</option>
              </select>
            </label>
          )}
          <button
            className="primary"
            disabled={busy || installing || !directory}
            onClick={() =>
              void run(async () =>
                setPlan(
                  await call(
                    selected === 'ide' ? 'ide.plan' : 'coding.install.plan',
                    selected === 'ide' ? { directory } : { directory, engine: selected },
                  ),
                ),
              )
            }
          >
            <Download size={16} />
            {busy ? '正在检查…' : state?.ready ? '检查最新版' : '获取安装计划'}
          </button>
          {plan && (
            <div className="development-plan">
              <strong>
                {app.title} · {plan.version}
              </strong>
              <p>{plan.directory}</p>
              <ul>
                {(
                  plan.steps || [
                    '下载官方独立包并校验摘要',
                    '在指定目录安装并验证版本',
                    '验证后加入桌面',
                  ]
                ).map((s: string) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
              <button
                className="primary"
                disabled={busy || installing}
                onClick={() =>
                  void run(async () => {
                    await call(selected === 'ide' ? 'ide.install' : 'coding.install', {
                      id: plan.id,
                      ...(selected === 'ide' ? { confirm: true } : {}),
                    });
                    setPlan(undefined);
                  })
                }
              >
                确认{state?.ready ? '更新' : '安装'}
              </button>
            </div>
          )}
          {selected === 'ide' && ide?.installError && <p role="alert">{ide.installError}</p>}
          {selected === 'ide' && ide?.installing && <p role="status">正在下载并安装代码编辑器…</p>}
          {selected !== 'ide' &&
            coding?.installs?.map((job: any) => (
              <details key={job.id} open={job.state !== 'completed'}>
                <summary>
                  {job.state === 'running'
                    ? '正在安装'
                    : job.state === 'completed'
                      ? '安装完成'
                      : job.state === 'cancelled'
                        ? '已取消'
                        : '安装失败'}
                </summary>
                <pre>{job.output}</pre>
                {job.state === 'running' && (
                  <button
                    onClick={() => void run(() => call('coding.install.cancel', { id: job.id }))}
                  >
                    取消安装
                  </button>
                )}
              </details>
            ))}
        </div>
      ) : (
        <div className="development-grid">
          {apps.map((a) => {
            const ready =
              a.id === 'ide'
                ? ide?.ready
                : coding?.engines?.find((e: any) => e.engine === a.id)?.ready;
            return (
              <button
                key={a.id}
                onClick={() => {
                  setSelected(a.id);
                  setDirectory(a.id === 'ide' ? ide.directory : coding.directory);
                  setPlan(undefined);
                }}
              >
                <span className={'development-logo ' + a.id}>
                  <Code2 size={24} />
                </span>
                <strong>{a.title}</strong>
                <small>{a.description}</small>
                <span className="development-state">
                  {ready ? (
                    <>
                      <Check size={14} />
                      已安装 · 管理
                    </>
                  ) : (
                    <>
                      <Download size={14} />
                      安装
                    </>
                  )}
                </span>
              </button>
            );
          })}
          {!apps.length && !busy && !error && !compatibility && <p>当前机器没有可安装的开发应用。</p>}
        </div>
      )}
    </section>
  );
}
