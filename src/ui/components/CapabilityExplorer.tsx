import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Play, RotateCw, Search, Square } from 'lucide-react';
import type { CapabilityContract, CommandResult } from '../../shared/command-console';
import type { Profile } from '../../shared/contracts';
import { CommandResultView } from './CommandConsole';
import './capability-explorer.css';

export function CapabilityExplorer({ active, onSettings, profiles = [] }: { active: boolean; onSettings: () => void; profiles?: Profile[] }) {
  const [tools, setTools] = useState<CapabilityContract[]>([]), [query, setQuery] = useState(''), [session, setSession] = useState('');
  const [selected, setSelected] = useState<CapabilityContract>(), [drafts, setDrafts] = useState<Record<string, string>>({});
  const [result, setResult] = useState<CommandResult>(), [error, setError] = useState(''), [busy, setBusy] = useState('');
  const pending = useRef(''), alive = useRef(true), loaded = useRef(false);
  const [profileId, setProfileId] = useState(''), [loadedTarget, setLoadedTarget] = useState({id:'',signature:'',name:'CShell 应用'});
  const sessions = useRef<Record<string, {id:string;signature:string}>>({}), connecting=useRef(false), loadingTarget=useRef(false);
  const disconnect=(id:string)=>window.cshell.commandRun({id:crypto.randomUUID(),text:`disconnect ${id}`}).catch(()=>{});
  const targetChanged=profileId!==loadedTarget.id || (!!loadedTarget.id && JSON.stringify(profiles.find(p=>p.id===loadedTarget.id))!==loadedTarget.signature);
  const targetKey=JSON.stringify([loadedTarget.id,loadedTarget.signature]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; if (pending.current&&!connecting.current) void window.cshell.commandCancel(pending.current).catch(() => {}); for(const value of Object.values(sessions.current))void disconnect(value.id);sessions.current={}; }; }, []);
  const execute = async (text: string, targetSession = session) => {
    if (!alive.current || pending.current) return;
    const id = crypto.randomUUID(); pending.current = id; setBusy(id); setError('');
    try { const response = await window.cshell.commandRun({ id, text, ...(targetSession.trim() ? { sessionId: targetSession.trim() } : {}) }); if (alive.current) return response;
      const created=connecting.current?(response.value as {sessionId?:string}|undefined)?.sessionId:undefined;if(created)await disconnect(created);
    }
    catch (e) { if (alive.current) setError(String(e)); }
    finally { pending.current = ''; if (alive.current) setBusy(''); }
  };
  const refresh = async () => { const value = await execute('tools'); if (value) { setTools(value.value as CapabilityContract[]); setSelected(undefined); } };
  const selectTarget = async () => {
    if(loadingTarget.current||pending.current||!alive.current)return;
    loadingTarget.current=true;
    try {
    let next = '';
    const profile=profiles.find(p=>p.id===profileId),signature=profile?JSON.stringify(profile):'';
    if (profileId) {
      if(!profile){setError('连接已删除，请重新选择');return;}
      const cached=sessions.current[profileId];
      if(cached&&cached.signature!==signature){await disconnect(cached.id);delete sessions.current[profileId];}
      next = sessions.current[profileId]?.id || '';
      if (!next) { connecting.current=true; const response = await execute(`connect ${profileId}`, ''); connecting.current=false; const value = response?.value as {sessionId?:string} | undefined; if (!value?.sessionId) return; next = value.sessionId; sessions.current[profileId] = {id:next,signature}; }
    }
    if(!alive.current)return;
    setLoadedTarget({id:profileId,signature,name:profile?.name||'CShell 应用'});
    setSession(next); setSelected(undefined); setTools([]); setResult(undefined);
    const value = await execute('tools', next); if (value) setTools(value.value as CapabilityContract[]);
    } finally { loadingTarget.current=false; }
  };
  useEffect(() => { if (active && !loaded.current) { loaded.current = true; void refresh(); } }, [active]);
  const choose = async (tool: CapabilityContract) => {
    setSelected(tool); setResult(undefined);
    const value = await execute(`help ${tool.id}`);
    if (value && Array.isArray(value.value) && value.value[0]) {
      const guide = value.value[0] as CapabilityContract; setSelected(guide);
      const key=targetKey+':'+guide.id;
      setDrafts(v => v[key] !== undefined ? v : { ...v, [key]: JSON.stringify(guide.examples?.[0]?.input || {}, null, 2) });
    }
  };
  const draftKey=selected?targetKey+':'+selected.id:'';
  const draft = selected ? drafts[draftKey] ?? '{}' : '{}';
  const properties = selected?.inputSchema?.properties as Record<string, any> | undefined;
  const required = selected?.inputSchema?.required as string[] | undefined;
  let values: Record<string, unknown> = {}; try { values = JSON.parse(draft); } catch { /* JSON remains editable. */ }
  const field = (key: string, value: unknown) => setDrafts(v => ({ ...v, [draftKey]: JSON.stringify({ ...values, [key]: value }, null, 2) }));
  return <section className="capability-explorer" aria-label="能力浏览器">
    <header><strong>能力浏览器</strong><button aria-label="刷新可用能力" title="刷新可用能力" disabled={!!busy} onClick={() => void refresh()}><RotateCw size={16}/></button></header>
    <div className="capability-context"><label>选择范围<select aria-label="能力浏览器操作范围" value={profileId} disabled={!!busy} onChange={e=>setProfileId(e.target.value)}><option value="">CShell 应用</option>{profiles.filter(p=>!p.protocol||['ssh','sftp','ftp','ftps','client'].includes(p.protocol)).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><button disabled={!!busy} onClick={() => void selectTarget()}>载入</button></div>
    <div className="capability-session"><span>实际目标：{loadedTarget.name}{session?` · ${session.slice(0,8)}`:''}{targetChanged?' · 请载入新选择后操作':''}</span>{session&&<button disabled={!!busy} title="关闭此能力浏览器创建的 API 连接" onClick={()=>void execute(`disconnect ${session}`).then(value=>{if(value){for(const key of Object.keys(sessions.current))if(sessions.current[key].id===session)delete sessions.current[key];setSession('');setProfileId('');setLoadedTarget({id:'',signature:'',name:'CShell 应用'});setSelected(undefined);setTools([]);setResult(undefined);}})}>断开</button>}</div>
    {error && <div role="alert" className="command-api-state"><span>{error}</span><button onClick={onSettings}>设置</button></div>}
    <div className="capability-body">{!selected ? <>
      <label className="capability-search"><Search size={15}/><input aria-label="搜索能力" placeholder="搜索名称或用途" value={query} onChange={e => setQuery(e.target.value)}/></label>
      {!tools.length && <p className="capability-empty">{busy ? '正在读取能力目录…' : '没有可用能力。启用 API 并授权后刷新；选择机器并点击「载入」查看它的能力。'}</p>}
      <div className="capability-list">{tools.filter(t => `${t.name} ${t.description}`.toLowerCase().includes(query.toLowerCase())).map((tool, i) => <button key={`${tool.id}-${i}`} disabled={!!busy} onClick={() => void choose(tool)}><strong>{tool.name}</strong><span>{tool.description}</span><small>{tool.effects === 'write' ? '操作' : '读取'} · {tool.permission}</small></button>)}</div>
    </> : <div className="capability-detail"><button disabled={!!busy} onClick={() => { setSelected(undefined); setResult(undefined); }}><ArrowLeft size={15}/>全部能力</button><h2>{selected.name}</h2><p>{selected.description}</p><small>{selected.effects === 'write' ? '此操作会改变目标状态' : '读取目标信息'} · {selected.permission}</small>
      {properties && <div className="capability-fields">{Object.entries(properties).filter(([, schema]) => ['string', 'number', 'integer', 'boolean'].includes(schema.type) || schema.enum).map(([key, schema]) => <label key={key}>{key}{required?.includes(key) ? ' *' : ''}{schema.description && <small>{schema.description}</small>}{schema.enum ? <select value={String(values[key] ?? '')} onChange={e => field(key, schema.enum.find((v: unknown) => String(v) === e.target.value))}><option value="">请选择</option>{schema.enum.map((v: unknown) => <option key={String(v)} value={String(v)}>{String(v)}</option>)}</select> : schema.type === 'boolean' ? <select value={values[key] === undefined ? '' : String(values[key])} onChange={e => field(key, e.target.value === '' ? undefined : e.target.value === 'true')}><option value="">默认</option><option value="true">是</option><option value="false">否</option></select> : <input value={String(values[key] ?? '')} type={schema.type === 'number' || schema.type === 'integer' ? 'number' : /password|token|secret|credential/i.test(key) ? 'password' : 'text'} onChange={e => field(key, e.target.value === '' ? undefined : schema.type === 'string' ? e.target.value : Number(e.target.value))}/>}</label>)}</div>}
      <details><summary>完整 JSON 参数与结构</summary><textarea aria-label="能力 JSON 参数" spellCheck={false} value={draft} onChange={e => setDrafts(v => ({ ...v, [draftKey]: e.target.value }))}/><pre>{JSON.stringify(selected.inputSchema, null, 2)}</pre></details>
      <div className="capability-actions">{busy ? <button onClick={() => void window.cshell.commandCancel(busy)}><Square size={15}/>停止等待</button> : <button className="primary" disabled={targetChanged} onClick={() => { setResult(undefined); void execute(`call ${selected.name} ${draft}`).then(v => { if (v) setResult(v); }); }}><Play size={15}/>{selected.effects === 'write' ? '执行操作' : '读取'}</button>}</div>
      {result && <div className="capability-result"><CommandResultView result={result}/></div>}
    </div>}</div>
  </section>;
}
