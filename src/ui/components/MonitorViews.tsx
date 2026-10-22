import { useEffect, useRef, useState } from 'react';
import { Plus, Monitor, Play, Trash2, Save, X } from 'lucide-react';
import type { Config } from '../../shared/contracts';
import type { AiThread, AiProvider } from '../../shared/ai';
import {useI18n} from '../i18n';
import { arrangeViewTiles, localViewProfiles, type MonitorView, type ViewDisplay, type ViewTile } from '../../shared/monitor-views';
import './monitor-views.css';

export function MonitorViews({ config }: { config: Config }) {
  const {locale}=useI18n(); const text=(zh:string,en:string)=>locale==='en-US'?en:zh;
  const [views, setViews] = useState<MonitorView[]>([]);
  const [displays, setDisplays] = useState<ViewDisplay[]>([]);
  const [draft, setDraft] = useState<MonitorView>();
  const drafts = useRef(new Map<string, MonitorView>());
  const [deletePending, setDeletePending] = useState(false);
  useEffect(() => { if (draft) drafts.current.set(draft.id, draft); setDeletePending(false); }, [draft]);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [profileId, setProfileId] = useState('');
  const [sourceKind, setSourceKind] = useState<'machine' | 'ai'>('machine');
  const [threads, setThreads] = useState<AiThread[]>([]), [threadId, setThreadId] = useState('');
  const [providers,setProviders]=useState<AiProvider[]>([]),[newProvider,setNewProvider]=useState('');
  useEffect(() => { if (sourceKind === 'ai') void window.cshell.aiSnapshot().then(s => {setThreads(s.threads);setProviders(s.providers);}).catch(e => setError(String(e))); }, [sourceKind]);
  const profiles = [...config.profiles.filter(p => !p.protocol || p.protocol === 'ssh' || p.protocol === 'client'),...(window.cshell.platform==='win32'?localViewProfiles:[])];
  const refresh = async () => { const [v, d] = await Promise.all([window.cshell.monitorViews(), window.cshell.viewDisplays()]); setViews(v); setDisplays(d); };
  useEffect(() => { void refresh().catch(e => setError(String(e))); }, []);
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); setError(''); setNotice(''); try { await fn(); } catch (e) { setError(String(e)); } finally { setBusy(false); } };
  const update = (id: string, patch: Partial<ViewTile>) => {
    if (!draft) return;
    try {
      let tiles = draft.tiles.map(t => t.id === id ? { ...t, ...patch } : t);
      if (patch.displayId) tiles = [...tiles.filter(t => t.displayId !== patch.displayId), ...arrangeViewTiles(tiles.filter(t => t.displayId === patch.displayId), 'grid')];
      setDraft({ ...draft, tiles });
    } catch (e) { setError(String(e)); }
  };
  const save = async () => { if (!draft) return; await window.cshell.saveMonitorView(draft); await refresh(); setNotice('已保存。已打开的视图需关闭后重新打开以应用来源配置。'); };
  const add = (created?: AiThread) => {
    const profile = profiles.find(p => p.id === profileId) ?? profiles[0];
    const thread = created ?? threads.find(t => t.id === threadId) ?? threads[0];
    if (!draft || (sourceKind === 'ai' ? !thread : !profile)) return;
    const displayId = displays[0]?.id ?? '';
    const siblings = draft.tiles.filter(t => t.displayId === displayId);
    try {
      const tile: ViewTile = { id: crypto.randomUUID(), profileId: sourceKind === 'ai' ? '' : profile.id, label: sourceKind === 'ai' ? thread.title.slice(0,80) || '智能体' : profile.name,
        ...(sourceKind === 'ai' ? {threadId: thread.id} : {}),
        kind: sourceKind === 'ai' ? 'ai' : localViewProfiles.some(p=>p.id===profile.id)?'local':profile.protocol === 'client' ? 'desktop' : 'ssh', shell:profile?.name.includes('CMD')?'cmd':'powershell', displayId,
        column: 0, row: 0, width: 12, height: 12, directory: '', command: '', screen: '' };
      setDraft({ ...draft, tiles: [...draft.tiles.filter(t => t.displayId !== displayId), ...arrangeViewTiles([...siblings, tile], 'grid')] });
    } catch (e) { setError(String(e)); }
  };
  return <section className="monitor-views editor-page">
    <header><div><h1>视图</h1><p className="muted">把终端、远程桌面和智能体会话放在一起，保存常用布局。</p></div>
      <button onClick={() => { setDraft({ id: crypto.randomUUID(), name: '新视图', tiles: [] }); setNotice(''); }}><Plus size={16}/>新建视图</button></header>
    <div className="view-library">{views.map(v => <article key={v.id}>
      <button onClick={() => setDraft(structuredClone(drafts.current.get(v.id) ?? v))}><Monitor size={18}/><strong>{v.name}</strong><small>{v.tiles.length} 个区域</small></button>
      <button title={'打开 '+v.name} aria-label={'打开 '+v.name} disabled={busy} onClick={() => void run(() => window.cshell.openMonitorView(v.id))}><Play size={16}/></button>
      <button title={'关闭 '+v.name+' 的窗口'} aria-label={'关闭 '+v.name+' 的窗口'} onClick={() => void run(() => window.cshell.closeMonitorView(v.id))}><X size={16}/></button>
    </article>)}</div>
    {draft && <div className="view-editor">
      {sourceKind === 'ai' && <div className="view-actions">
        <span className="muted">{text('新建智能体会话','New agent conversation')}</span>
        <select aria-label={text('新会话模型基座','New conversation provider')} value={newProvider || providers[0]?.id || ''} onChange={e=>setNewProvider(e.target.value)}>
          {!providers.length && <option value="">{text('请先配置模型基座','Configure a provider first')}</option>}{providers.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button disabled={busy || !providers.length} onClick={()=>void run(async()=>{
          const created=await window.cshell.aiThreadCreate('workspace',newProvider || providers[0].id,'review');
          setThreads(old=>[created,...old]);setThreadId(created.id);add(created);
        })}>{text('新建会话并加入','Create and add conversation')}</button>
      </div>}
      <div className="view-actions"><label>名称<input value={draft.name} maxLength={80} onChange={e => setDraft({ ...draft, name: e.target.value })}/></label>
        <button disabled={busy} onClick={() => void run(save)}><Save size={16}/>保存</button>
        <button className="primary" disabled={busy || !draft.tiles.length} onClick={() => void run(async () => { await save(); await window.cshell.openMonitorView(draft.id); })}>保存并打开</button>
        <button disabled={busy} onClick={() => setDeletePending(true)}><Trash2 size={16}/>删除视图</button>
      </div>
      {deletePending && <div className="view-actions" role="alert"><span>删除此布局并关闭它创建的连接？</span><button onClick={() => setDeletePending(false)}>取消</button><button onClick={() => void run(async () => { await window.cshell.closeMonitorView(draft.id); await window.cshell.deleteMonitorView(draft.id); drafts.current.delete(draft.id); setDraft(undefined); await refresh(); })}>确认删除</button></div>}
      <div className="view-actions"><select aria-label={text('区域来源','Pane source')} value={sourceKind} onChange={e => setSourceKind(e.target.value as 'machine'|'ai')}><option value="machine">{text('机器','Machine')}</option><option value="ai">{text('智能体会话','AI conversation')}</option></select>{sourceKind === 'ai' ? <select aria-label={text('智能体会话','AI conversation')} value={threadId || threads[0]?.id || ''} onChange={e => setThreadId(e.target.value)}>{!threads.length && <option value="">{text('暂无会话，可新建后加入','No conversations yet; create one to add')}</option>}{threads.map(t => <option key={t.id} value={t.id}>{t.title} · {t.target || 'CShell'}</option>)}</select> : <select aria-label="添加机器" value={profileId || profiles[0]?.id || ''} onChange={e => setProfileId(e.target.value)}>{profiles.map(p => <option key={p.id} value={p.id}>{p.name} · {localViewProfiles.some(local => local.id === p.id) ? '本机终端' : p.protocol === 'client' ? 'CAgent 桌面' : 'SSH'}</option>)}</select>}<button disabled={sourceKind === 'ai' ? !threads.length : !profiles.length} onClick={() => add()}><Plus size={16}/>添加区域</button></div>
      <details className="view-source-help"><summary>会话与命令如何恢复</summary><p className="muted">SSH 使用已保存的连接认证；命令需在区域中点击执行，不随视图恢复重复启动。screen 会自动共享附加，不踢出现有终端。关闭视图会断开它创建的会话，长期服务请放在 screen / tmux 中。</p></details>
      <div className="view-actions"><label>视图模式<select value={draft.mode ?? 'tile'} onChange={e => {
        const mode = e.target.value as NonNullable<MonitorView['mode']>;
        try {
          const tiles = [...new Set(draft.tiles.map(t => t.displayId))].flatMap(id => arrangeViewTiles(draft.tiles.filter(t => t.displayId === id), mode === 'focus' ? 'focus' : 'grid'));
          setDraft({ ...draft, mode, tiles });
        } catch (error) { setError(String(error)); }
      }}><option value="tile">平铺视图</option><option value="focus">主次视图</option><option value="overview">小窗视图 · 点击放大操作</option></select></label></div>
      {draft.tiles.map((tile, i) => <article className="view-source" key={tile.id}>
        <div className="view-actions"><strong>区域 {i + 1} · {tile.kind === 'ai' ? '智能体会话' : tile.kind === 'desktop' ? 'CAgent 远程桌面' : '终端'}</strong><button aria-label={'移除 '+tile.label} title="移除区域" onClick={() => setDraft({ ...draft, tiles: draft.tiles.filter(t => t.id !== tile.id) })}><X size={16}/></button></div>
        <div className="view-source-fields"><label>标题<input value={tile.label} onChange={e => update(tile.id, { label: e.target.value })}/></label>
          <label>显示器<select value={tile.displayId} onChange={e => update(tile.id, { displayId: e.target.value })}>{!displays.some(d => d.id === tile.displayId) && <option value={tile.displayId}>未连接的显示器（打开时回到主屏）</option>}{displays.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}</select></label>
          {config.profiles.find(p=>p.id===tile.profileId)?.protocol==='client' && <label>内容<select value={tile.kind} onChange={e=>update(tile.id,{kind:e.target.value as ViewTile['kind']})}><option value="desktop">远程桌面</option><option value="client-terminal">终端</option></select></label>}
          {(tile.kind==='local'||tile.kind==='client-terminal') && <label>终端<select value={tile.shell??'powershell'} onChange={e=>update(tile.id,{shell:e.target.value as ViewTile['shell']})}><option value="powershell">PowerShell</option><option value="cmd">CMD</option>{tile.kind==='client-terminal'&&<option value="sh">系统 Shell</option>}</select></label>}
          {tile.kind === 'ssh' && <><label>工作目录<input placeholder="/srv/minecraft" value={tile.directory} onChange={e => update(tile.id, { directory: e.target.value })}/></label>
            <label>启动或观察命令（手动执行）<input value={tile.command} placeholder="tail -F logs/latest.log" onChange={e => update(tile.id, { command: e.target.value })}/></label>
            <label>已有 screen 会话（优先于命令）<input value={tile.screen} placeholder="会话名或 PID.名称" onChange={e => update(tile.id, { screen: e.target.value })}/></label></>}
        </div>
      </article>)}
    </div>}
    {!draft && !views.length && <p>新建一个视图，然后添加已保存的 SSH 或 CAgent 连接。</p>}
    {error && <p role="alert" className="form-error">{error}</p>}{notice && <p role="status">{notice}</p>}
  </section>;
}
