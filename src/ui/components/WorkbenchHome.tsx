import { useEffect, useState } from 'react';
import { ArrowUpRight, Grid2X2, LayoutDashboard, Monitor, Plus, Terminal, View } from 'lucide-react';
import type { Config, Profile } from '../../shared/contracts';
import type { MonitorView } from '../../shared/monitor-views';
import './workbench-home.css';

export function WorkbenchHome({ config, active, currentCount, onNew, onViews, onConnect, onCurrent }:
  { config: Config; active: boolean; currentCount: number; onNew: () => void; onViews: () => void;
    onConnect: (profile: Profile) => void; onCurrent: (mode: 'tile' | 'focus' | 'overview') => Promise<void> }) {
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
