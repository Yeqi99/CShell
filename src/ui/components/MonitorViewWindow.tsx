import { useEffect, useRef, useState } from 'react';
import { Save, SlidersHorizontal, RotateCcw, ArrowLeft, Grid2X2, X } from 'lucide-react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { Config, Profile } from '../../shared/contracts';
import { type MonitorView, type ViewTile, type BorrowedViewTerminal, viewShellCommand, arrangeViewTiles, localViewProfiles } from '../../shared/monitor-views';
import { LocaleContext } from '../i18n';
import { mergeMonitorDisplay } from '../../shared/monitor-view-layout';
import { AiView } from './AiView';
import { MonitorAiAssist } from './MonitorAiAssist';
import { SavedConnection } from './SavedConnection';
import { AgentDesktopView } from './AgentDesktopView';
import { terminalEvent, subscribeTerminal } from '../terminalBus';
import { ViewTerminalMenu } from './ViewTerminalMenu';
import '@xterm/xterm/css/xterm.css';
import './monitor-views.css';

function SshView({ tile, profile, config, borrowed }: { tile: ViewTile; profile: Profile; config: Config; borrowed?: BorrowedViewTerminal }) {
  const [id, setId] = useState(borrowed?.sessionId ?? ''), [closed, setClosed] = useState(false), [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const attempted = useRef(false);
  const host = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const ownedSession = useRef(id); ownedSession.current=id;
  const live = useRef(true);
  useEffect(() => {live.current=true;return () => { live.current = false;if(!borrowed&&ownedSession.current)void window.cshell.disconnect(ownedSession.current).catch(()=>{}); };}, []);
  const connectTerminal = async () => {
    setConnecting(true); setError('');
    try {
      const result = tile.kind === 'local'
        ? await window.cshell.localTerminal((tile.shell ?? 'powershell') as 'cmd'|'powershell')
        : await window.cshell.clientConnect(tile.profileId, tile.shell ?? 'powershell');
      if (!live.current) { await window.cshell.disconnect(result.sessionId); return; }
      setId(result.sessionId); setClosed(false);
    } catch (e) { if (live.current) setError(String(e)); }
    finally { if (live.current) setConnecting(false); }
  };
  useEffect(() => {
    if (!borrowed && tile.kind !== 'ssh' && !attempted.current) {
      attempted.current = true;
      void connectTerminal();
    }
  }, []);
  useEffect(() => {
    if (!id || !host.current) return;
    const term = new Terminal({ scrollback: 3000, fontSize: 13, cursorBlink: true,
      theme: config.preferences.theme === 'dark' ? { background: '#101820', foreground: '#e6edf3' } : { background: '#ffffff', foreground: '#24354b' } });
    const fit = new FitAddon(); term.loadAddon(fit); term.open(host.current);
    terminal.current=term;
    if (borrowed) term.write(borrowed.snapshot.data);
    const stop = subscribeTerminal(id, data => term.write(data, () => { void window.cshell.acknowledge(id, data.length).catch(() => {}); }));
    const input = term.onData(data => { void window.cshell.input(id, data).catch(e => setError(String(e))); });
    const resize = () => { if (!host.current?.clientWidth) return; fit.fit(); void window.cshell.resize(id, term.cols, term.rows).catch(() => {}); };
    const observer = new ResizeObserver(resize); observer.observe(host.current); resize();
    window.addEventListener('focus', resize);
    const off = window.cshell.events(e => { if (e.type === 'closed' && e.sessionId === id) { setClosed(true); setError(e.error || '连接已断开'); } });
    return () => { off(); window.removeEventListener('focus', resize); observer.disconnect(); input.dispose(); stop(); terminal.current=null;term.dispose(); };
  }, [id, config.preferences.theme]);
  return <div className="view-ssh">
    {!id && tile.kind!=='ssh' ? <button disabled={connecting} onClick={()=>void connectTerminal()}>{connecting?'正在连接…':'连接 '+(tile.shell??'PowerShell')}</button> : !id ? <SavedConnection profile={profile} saved={config.savedCredentials.includes(profile.id)} onDone={() => {}} onConnect={async (p, credentials) => {
      const result = await window.cshell.connect(p.id, credentials);
      if (!live.current) { await window.cshell.disconnect(result.sessionId); return; }
      setId(result.sessionId); setClosed(false); setSubmitted(!!tile.screen);
      if (tile.screen) await window.cshell.input(result.sessionId, viewShellCommand(tile) + '\r');
    }}/> : <><div className="view-session-actions">
      {(tile.screen || tile.directory || tile.command) && <button disabled={closed || submitted} title={viewShellCommand(tile)} onClick={() => {
        setSubmitted(true); void window.cshell.input(id, viewShellCommand(tile) + '\r').catch(e => { setSubmitted(false); setError(String(e)); });
      }}>{submitted ? '已提交命令' : tile.screen ? '附加 screen' : '执行配置命令'}</button>}
      {borrowed ? <span className="view-session-note muted">复用工作台会话</span> : <button className="view-session-reconnect" title="重新连接" aria-label="重新连接" onClick={() => { void window.cshell.disconnect(id).catch(() => {}); setId(''); setError(''); }}><RotateCcw size={13}/></button>}
    </div><div className="view-terminal" ref={host}/></>}
    {error && <p role="alert" className="form-error">{error}</p>}
    <ViewTerminalMenu host={host} terminal={terminal} sessionId={id} closed={closed} onError={setError}/>
  </div>;
}
function DesktopTile({ tile }: { tile: ViewTile }) {
  const [target, setTarget] = useState(''), [status, setStatus] = useState<any>(), [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true;
    void window.cshell.agentMachineOpen(tile.profileId).then(async t => {
      const s = await window.cshell.agentCall(t.id, { method: 'desktop.status' });
      if (alive) { setTarget(t.id); setStatus(s); }
    }).catch(e => { if (alive) setError(String(e)); });
    return () => { alive = false; };
  }, [tile.profileId, retry]);
  return <>{target && status ? <AgentDesktopView target={target} canView={status.viewAllowed} canControl={status.controlAllowed} autoConnect/> : <p>{error || '正在连接机器…'}</p>}{error && <button onClick={() => { setError(''); setRetry(n => n + 1); }}>重新连接</button>}{status && !status.viewAllowed && <p role="alert">远端桌面未就绪或尚未授权，请在机器工作区检查。</p>}</>;
}
export function MonitorViewWindow() {
  const [state, setState] = useState<Awaited<ReturnType<typeof window.cshell.monitorViewInit>>>();
  const [config, setConfig] = useState<Config>(), [editing, setEditing] = useState(false);
  const [message, setMessage] = useState(''), [selected, setSelected] = useState('');
  const [focused, setFocused] = useState('');
  const ownedIds = useRef(new Set<string>());
  useEffect(() => {
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape' && focused) setFocused(''); };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [focused]);
  useEffect(() => {
    let ready = false;
    const queued: import('../../shared/contracts').SessionEvent[] = [];
    const cutoffs = new Map<string, number>();
    const forward = (event: import('../../shared/contracts').SessionEvent) => {
      if (event.type !== 'data' || (event.sequence ?? 0) > (cutoffs.get(event.sessionId) ?? -1)) terminalEvent(event);
    };
    const off = window.cshell.events(event => {
      if (ready) forward(event);
      else if (queued.length < 1000) queued.push(event);
    });
    void Promise.all([window.cshell.monitorViewInit(), window.cshell.config()]).then(([s, c]) => {
      for (const value of Object.values(s.borrowed ?? {})) cutoffs.set(value.sessionId, value.snapshot.sequence);
      queued.forEach(forward); queued.length = 0; ready = true;
      ownedIds.current = new Set(s.view.tiles.map(tile => tile.id));
      setState(s); setConfig({ ...c, profiles: [...c.profiles, ...(s.profiles ?? []).filter(p => !c.profiles.some(existing => existing.id === p.id))] }); document.documentElement.dataset.theme = c.preferences.theme;
    }).catch(e => setMessage(String(e)));
    return off;
  }, []);
  if (!state || !config) return <p>{message || '正在恢复视图…'}</p>;
  const update = (id: string, patch: Partial<ViewTile>) => setState(s => s && ({ ...s, view: { ...s.view, tiles: s.view.tiles.map(t => t.id === id ? { ...t, ...patch } : t) } }));
  const current = state.view.tiles.find(t => t.id === selected);
  const closePane = (id: string) => {
    setFocused(value => value === id ? '' : value);
    setSelected(value => value === id ? '' : value);
    setState(value => value && ({ ...value, view: { ...value.view,
      tiles: arrangeViewTiles(value.view.tiles.filter(tile => tile.id !== id), value.view.mode === 'focus' ? 'focus' : 'grid') } }));
    setMessage('区域已关闭；保存布局可保留下次打开的内容');
  };
  return <LocaleContext.Provider value={config.preferences.locale}><main className="monitor-screen">
    <header className="view-screen-bar"><strong>{state.view.name}</strong>
      <select aria-label="视图模式" value={state.view.mode ?? 'tile'} onChange={e => {
        const mode = e.target.value as NonNullable<MonitorView['mode']>;
        setFocused(''); setEditing(false);
        setState({ ...state, view: { ...state.view, mode, tiles: arrangeViewTiles(state.view.tiles, mode === 'focus' ? 'focus' : 'grid') } });
      }}><option value="tile">平铺视图</option><option value="focus">主次视图</option><option value="overview">小窗视图</option></select>
      {focused && <button title="返回全部预览" aria-label="返回全部预览" onClick={() => setFocused('')}><ArrowLeft size={15}/></button>}
      <button className="view-layout-toggle" title={editing ? '完成调整' : '调整布局'} aria-label={editing ? '完成调整' : '调整布局'} onClick={() => { setFocused(''); setEditing(!editing); }} aria-pressed={editing}><SlidersHorizontal size={15}/></button>
      {editing && <><button title="均衡网格" aria-label="均衡网格" onClick={() => setState({ ...state, view: { ...state.view, tiles: arrangeViewTiles(state.view.tiles, 'grid') } })}><Grid2X2 size={15}/></button>
      <span className="view-edit-hint">拖动标题交换位置</span></>}
      <button title="保存布局" aria-label="保存布局" onClick={() => void (async () => {
        const saved = (await window.cshell.monitorViews()).find(v => v.id === state.view.id) ?? state.view;
        await window.cshell.saveMonitorView(mergeMonitorDisplay(saved, state.view, ownedIds.current));
        setMessage('布局已保存');
      })().catch(e => setMessage(String(e)))}><Save size={15}/></button><span role="status">{message}</span>
    </header>
    {editing && current && <div className="view-screen-bar"><strong>{current.label}</strong>{(['column', 'row', 'width', 'height'] as const).map((key, i) => <label key={key}>{['列', '行', '宽', '高'][i]}<input type="number" min={key === 'column' || key === 'row' ? 0 : 1} max={12} value={current[key]} onChange={e => {
      const n = Number(e.target.value), next = { ...current, [key]: n };
      if (Number.isInteger(n) && n >= (i < 2 ? 0 : 1) && next.column + next.width <= 12 && next.row + next.height <= 12) update(current.id, { [key]: n });
    }}/></label>)}</div>}
    <div className={'view-grid' + (focused ? ' has-focused' : '')}>{state.view.tiles.map(tile => {
      const profile = [...config.profiles,...localViewProfiles].find(p => p.id === tile.profileId);
      return <section className={'view-tile' + (selected === tile.id && editing ? ' selected' : '') + (focused === tile.id ? ' view-focused' : '')} key={tile.id}
        style={{ gridColumn: `${tile.column + 1} / span ${tile.width}`, gridRow: `${tile.row + 1} / span ${tile.height}` }}
        onDragOver={e => { if (editing && e.dataTransfer.types.includes('application/x-cshell-view-tile')) e.preventDefault(); }}
        onDrop={e => {
          e.preventDefault(); const source = state.view.tiles.find(t => t.id === e.dataTransfer.getData('application/x-cshell-view-tile'));
          if (!editing || !source || source.id === tile.id) return;
          const box = (t: ViewTile) => ({ column: t.column, row: t.row, width: t.width, height: t.height });
          setState({ ...state, view: { ...state.view, tiles: state.view.tiles.map(t => t.id === source.id ? { ...t, ...box(tile) } : t.id === tile.id ? { ...t, ...box(source) } : t) } });
        }}>
        <div className="view-tile-header"><button className="view-tile-title" draggable={editing} title={state.view.mode === 'focus' ? '点击设为主视图' : tile.label} onClick={() => {
          setSelected(tile.id);
          if (!editing && state.view.mode === 'overview') setFocused(tile.id);
          if (!editing && state.view.mode === 'focus') setState({ ...state, view: { ...state.view, tiles: arrangeViewTiles([tile, ...state.view.tiles.filter(t => t.id !== tile.id)], 'focus') } });
        }}
          onDragStart={e => { e.dataTransfer.setData('application/x-cshell-view-tile', tile.id); e.dataTransfer.effectAllowed = 'move'; }}>{tile.label}<small>{tile.kind === 'ai' ? '智能体' : profile?.host || '连接已删除'}</small></button>
        <button className="view-pane-close" title={'关闭区域：'+tile.label} aria-label={'关闭区域：'+tile.label} onClick={() => closePane(tile.id)}><X size={13}/></button></div>
        <div className="view-tile-content" inert={state.view.mode === 'overview' && focused !== tile.id && !editing}>{tile.kind === 'ai' ? <AiView threadId={tile.threadId!}/> : tile.kind === 'local' && window.cshell.platform !== 'win32' ? <p role="status">此区域使用 Windows 本机终端。请在视图设置中选择当前系统可用的 SSH 或 CAgent 连接。</p> : !profile ? <p role="alert">请重新配置该区域的连接。</p> : tile.kind !== 'desktop' ? <SshView tile={tile} profile={profile} config={config} borrowed={state.borrowed?.[tile.id]}/> : <DesktopTile tile={tile}/>}</div>
        {state.view.mode === 'overview' && !editing && !focused && <button className="view-preview-open" aria-label={'放大 '+tile.label} title={'点击放大并操作 '+tile.label} onClick={() => setFocused(tile.id)}><span>点击放大</span></button>}
      </section>;
    })}{!state.view.tiles.length && <p className="view-empty">当前窗口没有区域。可保存布局，或关闭窗口后从工作台重新配置视图。</p>}</div>
  <MonitorAiAssist/></main></LocaleContext.Provider>;
}
