import { useEffect, useState } from 'react';
import { ArrowUpRight, Grid2X2, LayoutDashboard, Monitor, Plus, Terminal, View, Blocks, Settings2, Bot, Code2, Minus, X } from 'lucide-react';
import type { Config, Profile } from '../../shared/contracts';
import type { MonitorView } from '../../shared/monitor-views';
import './workbench-home.css';
import { CommandConsole } from './CommandConsole';
import { CapabilityExplorer } from './CapabilityExplorer';
import './workbench-studio.css';

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
function WorkbenchStudio(props: WorkbenchProps) {
  type App = 'connections' | 'command' | 'capabilities';
  const [opened, setOpened] = useState<App[]>([]), [front, setFront] = useState<App>();
  const open = (app: App) => { setOpened(v => v.includes(app) ? v : [...v, app]); setFront(app); };
  const labels = { connections: '连接与视图', command: '命令台', capabilities: '能力浏览器' };
  const apps = [
    ['connections', '连接与视图', Monitor, () => open('connections')], ['command', '命令台', Terminal, () => open('command')],
    ['capabilities', '能力浏览器', Code2, () => open('capabilities')], ['extensions', '扩展', Blocks, props.onExtensions],
    ['agent', '智能体', Bot, props.onAgent], ['settings', '设置', Settings2, props.onSettings],
  ] as const;
  return <div className="workbench-studio"><div className="studio-desktop"><div className="studio-icons">{apps.map(([id, label, Icon, action]) => <button key={id} onClick={action}><span><Icon size={27}/></span>{label}</button>)}</div><div className="studio-brand" aria-hidden="true">CShell<span>工作台</span></div>
    {opened.map(app => <section key={app} className="studio-window" aria-label={labels[app]} hidden={front !== app}><header><strong>{labels[app]}</strong><button title="最小化" aria-label={`最小化${labels[app]}`} onClick={() => setFront(undefined)}><Minus size={16}/></button><button title="关闭" aria-label={`关闭${labels[app]}`} onClick={() => { setOpened(v => v.filter(a => a !== app)); setFront(undefined); }}><X size={16}/></button></header><div className="studio-content">{app === 'connections' ? <WorkbenchOverview {...props} active={props.active && front === app}/> : app === 'command' ? <CommandConsole active={props.active && front === app} onSettings={props.onSettings} onNewTab={props.onCommandTab}/> : <CapabilityExplorer active={props.active && front === app} onSettings={props.onSettings} profiles={props.config.profiles}/>}</div></section>)}
    </div><footer className="studio-taskbar"><button title="显示工作台桌面" aria-label="显示工作台桌面" onClick={() => setFront(undefined)}><Grid2X2 size={19}/></button>{opened.map(app => <button key={app} aria-pressed={front === app} onClick={() => setFront(front === app ? undefined : app)}>{labels[app]}</button>)}<span>应用工作台</span></footer></div>;
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
