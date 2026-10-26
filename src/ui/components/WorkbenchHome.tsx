import { useEffect, useState } from 'react';
import { ArrowUpRight, Grid2X2, LayoutDashboard, Monitor, Plus, Terminal, View, Blocks, Settings2, Bot, Code2 } from 'lucide-react';
import type { Config, Profile } from '../../shared/contracts';
import type { MonitorView } from '../../shared/monitor-views';
import './workbench-home.css';
import { CommandConsole } from './CommandConsole';
import { CapabilityExplorer } from './CapabilityExplorer';
import './workbench-studio.css';
import { LinuxDesktop } from './LinuxDesktop';

type OverviewProps = { config: Config; active: boolean; currentCount: number; onNew: () => void; onViews: () => void;
    onConnect: (profile: Profile) => void; onCurrent: (mode: 'tile' | 'focus' | 'overview') => Promise<void> };
type WorkbenchProps = OverviewProps & { onView: (view: 'overview' | 'command' | 'visual') => Promise<void>; onSettings: () => void;
  onExtensions: () => void; onAgent: () => void; onCommandTab: () => void };
export function WorkbenchHome(props: WorkbenchProps) {
  const mode = props.config.preferences.workbenchView ?? 'overview';
  const [seen, setSeen] = useState(() => new Set([mode])), [error, setError] = useState('');
  useEffect(() => { setSeen(v => v.has(mode) ? v : new Set([...v, mode])); }, [mode]);
  return <section className="workbench-shell" aria-label="工作台"><header className="workbench-switcher"><h1>工作台</h1><div role="tablist" aria-label="工作台显示方式">{([
    ['overview', '概览', LayoutDashboard], ['command', '命令行', Terminal], ['visual', '可视化', Monitor],
  ] as const).map(([value, label, Icon], index, all) => <button key={value} role="tab" aria-selected={mode === value} tabIndex={mode === value ? 0 : -1} onClick={() => void props.onView(value).catch(e => setError(String(e)))} onKeyDown={e => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'Home' || e.key === 'End') { e.preventDefault(); const next = e.key === 'Home' ? 0 : e.key === 'End' ? 2 : (index + (e.key === 'ArrowRight' ? 1 : 2)) % 3; (e.currentTarget.parentElement?.children[next] as HTMLButtonElement)?.focus(); void props.onView(all[next][0]).catch(err => setError(String(err))); }
  }}><Icon size={15}/>{label}</button>)}</div></header>
    {error && <p role="alert" className="form-error">{error}</p>}
    <div className="workbench-mode" role="tabpanel" aria-label="概览" hidden={mode !== 'overview'}><WorkbenchOverview {...props} active={props.active && mode === 'overview'}/></div>
    {seen.has('command') && <div className="workbench-mode" role="tabpanel" aria-label="命令行" hidden={mode !== 'command'}><CommandConsole active={props.active && mode === 'command'} onSettings={props.onSettings} onNewTab={props.onCommandTab}/></div>}
    {seen.has('visual') && <div className="workbench-mode" role="tabpanel" aria-label="可视化" hidden={mode !== 'visual'}><WorkbenchStudio {...props} active={props.active && mode === 'visual'}/></div>}
  </section>;
}
const workbenchMachine = { deviceId: 'cshell-workbench', desktopOnly: true };
const noMachineCall = async () => { throw new Error('工作台不绑定远端机器'); };
function WorkbenchStudio(props: WorkbenchProps) {
  return <LinuxDesktop workbench name="CShell" machine={workbenchMachine} target="" call={noMachineCall} active={props.active} extraPanels={[
    { id: 'connections', label: '连接与视图', icon: Monitor, color: 'blue', content: active => <WorkbenchOverview {...props} active={active}/> },
    { id: 'command', label: '命令台', icon: Terminal, color: 'amber', content: active => <CommandConsole active={active} onSettings={props.onSettings} onNewTab={props.onCommandTab}/> },
    { id: 'capabilities', label: '能力浏览器', icon: Code2, color: 'green', content: active => <CapabilityExplorer active={active} onSettings={props.onSettings} profiles={props.config.profiles}/> },
    { id: 'extensions', label: '扩展', icon: Blocks, content: null, onOpen: props.onExtensions },
    { id: 'agent', label: '智能体', icon: Bot, content: null, onOpen: props.onAgent },
    { id: 'preferences', label: '偏好设置', icon: Settings2, content: null, onOpen: props.onSettings },
  ]}/>;
}
function WorkbenchOverview({ config, active, currentCount, onNew, onViews, onConnect, onCurrent }: OverviewProps) {
  const [views, setViews] = useState<MonitorView[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    if (active) void window.cshell.monitorViews().then(setViews).catch(e => setError(String(e)));
  }, [active]);
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); setError(''); try { await fn(); } catch (e) { setError(String(e)); } finally { setBusy(false); } };
  const connections = [...config.profiles].sort((a, b) => Number(b.favorite) - Number(a.favorite)).slice(0, 6);
  return <section className="workbench-home" aria-label="工作台首页">
    <header className="home-heading"><h1>工作台</h1></header>
    <div className="home-overview">
      <section className="home-current"><header><h2>当前连接</h2><span className="home-count">{currentCount}</span></header>
        <div className="home-mode-options">{([
          ['tile', '平铺视图', '均衡排列，一眼看全', Grid2X2],
          ['focus', '主次视图', '关注主要任务，兼顾其他', LayoutDashboard],
          ['overview', '小窗视图', '实时预览，点击放大操作', View],
        ] as const).map(([mode, title, description, Icon]) => <button key={mode} title={currentCount ? description : '连接机器后可使用'} disabled={!currentCount || busy} onClick={() => void run(() => onCurrent(mode))}><Icon size={15}/><strong>{title}</strong><small>{description}</small></button>)}</div>
      </section>
      <section className="home-saved"><header><h2>已保存视图</h2><span className="home-count">{views.length}</span><button className="home-icon-action" title="管理视图" aria-label="管理视图" onClick={onViews}><ArrowUpRight size={15}/></button></header>
        {views.length ? <div className="home-saved-list">{views.slice(0, 4).map(v => <button key={v.id} disabled={busy} onClick={() => void run(() => window.cshell.openMonitorView(v.id))}><span><strong title={v.name}>{v.name}</strong><small>{v.tiles.length} 个区域 · {v.mode === 'overview' ? '小窗' : v.mode === 'focus' ? '主次' : '平铺'}</small></span><ArrowUpRight size={16}/></button>)}</div>
          : <div className="home-empty-views"><p>保存常用的连接与布局。</p><button onClick={onViews}><Plus size={14}/>创建视图</button></div>}
      </section>
    </div>
    <section className="home-connections"><header><h2>快捷连接</h2><span className="home-count" title={`${config.profiles.length} 个已保存连接`}>{config.profiles.length}</span><button className="home-icon-action" title="新建连接" aria-label="新建连接" onClick={onNew}><Plus size={16}/></button></header>
      {connections.length ? <div className="home-connection-list">{connections.map(p => <button key={p.id} onClick={() => onConnect(p)}><span className="home-connection-icon">{p.protocol === 'client' || p.protocol === 'rdp' ? <Monitor size={18}/> : <Terminal size={18}/>}</span><span><strong title={p.name}>{p.name}</strong><small>{p.host || 'HTTP 工作区'}</small></span><ArrowUpRight size={15}/></button>)}</div>
        : <p className="home-empty-connections">还没有保存的连接，点击加号添加。</p>}
    </section>
    {error && <p role="alert" className="form-error">{error}</p>}
  </section>;
}
