import { useEffect, useRef, useState } from 'react';
import { ArrowUp, ExternalLink, Square, Terminal, Trash2 } from 'lucide-react';
import { commandHelp, commandLabel, parseConsoleCommand, type CapabilityContract, type CommandResult } from '../../shared/command-console';
import './command-console.css';

type Entry = { id: string; label: string; result?: CommandResult; error?: string };
function displayResult(result: CommandResult): CommandResult {
  const text = JSON.stringify(result.value);
  return text && text.length > 3000000 ? { ...result, value: text.slice(0, 120000) + '\n…结果过大，使用 CLI --out 保存完整结果。' } : result;
}
function boundedEntries(entries: Entry[]) {
  const next = entries.slice(-80); let size = 0;
  for (let i = next.length - 1; i >= 0; i--) { size += JSON.stringify(next[i]).length; if (size > 8000000) return next.slice(i + 1); }
  return next;
}
export function CommandConsole({ active, onSettings, onNewTab }: { active: boolean; onSettings: () => void; onNewTab?: () => void }) {
  const [draft, setDraft] = useState(''), [entries, setEntries] = useState<Entry[]>([]), [sessionId, setSessionId] = useState<string>();
  const [request, setRequest] = useState(''), [status, setStatus] = useState<{ enabled: boolean; running: boolean; error?: string }>();
  const pending = useRef(''), alive = useRef(true), input = useRef<HTMLTextAreaElement>(null), log = useRef<HTMLDivElement>(null);
  const owned = useRef(new Set<string>()), connecting = useRef(false);
  const disconnect = (id: string) => window.cshell.commandRun({id:crypto.randomUUID(),text:`disconnect ${id}`}).catch(()=>{});
  useEffect(() => { alive.current = true; return () => { alive.current = false; if (pending.current && !connecting.current) void window.cshell.commandCancel(pending.current).catch(() => {}); for(const id of owned.current) void disconnect(id); owned.current.clear(); }; }, []);
  useEffect(() => { if (active) void window.cshell.commandStatus().then(setStatus).catch(e => setStatus({ enabled: false, running: false, error: String(e) })); }, [active]);
  useEffect(() => { if (active && log.current) log.current.scrollTop = log.current.scrollHeight; }, [entries, active]);
  const submit = async (text = draft) => {
    if (pending.current || !text.trim()) return;
    if (text.trim() === 'clear') { setEntries([]); setDraft(''); return; }
    const id = crypto.randomUUID(); pending.current = id; setRequest(id); setDraft('');
    let parsed; try { parsed = parseConsoleCommand(text); } catch { /* Backend returns the validation error. */ }
    connecting.current = parsed?.type === 'invoke' && parsed.name === 'connect';
    setEntries(v => [...v.slice(-79), { id, label: commandLabel(text) }]);
    try {
      const result = await window.cshell.commandRun({ id, text, sessionId });
      const created = connecting.current && result.value && typeof result.value === 'object' ? (result.value as {sessionId?:string}).sessionId : undefined;
      if (created) { if (!alive.current) { await disconnect(created); return; } owned.current.add(created); }
      if(parsed?.type==='invoke'&&parsed.name==='disconnect')owned.current.delete(String(parsed.arguments.sessionId));
      if (!alive.current) return;
      if (result.kind === 'context') setSessionId(result.sessionId);
      setEntries(v => boundedEntries(v.map(item => item.id === id ? { ...item, result: displayResult(result) } : item)));
    } catch (e) { if (alive.current) setEntries(v => v.map(item => item.id === id ? { ...item, error: String(e) } : item)); }
    finally { pending.current = ''; connecting.current = false; if (alive.current) { setRequest(''); input.current?.focus(); } }
  };
  return <section className="command-console" aria-label="CShell 命令台">
    <header className="command-toolbar"><Terminal size={16}/><strong>CShell 命令台</strong><span title={sessionId}>{sessionId ? `会话 ${sessionId.slice(0, 8)}` : '应用范围'}</span>
      {onNewTab && <button title="在独立标签打开命令台" aria-label="新建命令台标签" onClick={onNewTab}><ExternalLink size={15}/></button>}
      <button title="清空显示" aria-label="清空命令台显示" disabled={!!request} onClick={() => setEntries([])}><Trash2 size={15}/></button>
    </header>
    {status && !status.running && <div className="command-api-state"><span>{status.error || '启用 API 并选择允许的机器和能力后，即可执行命令。'}</span><button onClick={onSettings}>打开设置</button></div>}
    <div className="command-output" ref={log} role="log" aria-label="命令结果" aria-live="polite">
      {!entries.length && <div className="command-welcome"><Terminal size={28}/><h2>一个入口，调用已授权的能力</h2><p>输入 tools 查找命令，help 查看参数。每个命令台独立保留草稿与结果。</p><div>{['help', 'tools', 'servers'].map(text => <button key={text} onClick={() => void submit(text)}>{text}</button>)}</div><small>这是 CShell 命令，不会作为系统 Shell 执行。关闭窗口不会重放命令。</small></div>}
      {entries.map(entry => <article key={entry.id} className="command-entry"><header><span aria-hidden="true">›</span><strong>{entry.label}</strong><span>{entry.error ? '未完成' : entry.result ? '完成' : '执行中'}</span></header>
        {entry.error ? <p role="alert" className="form-error">{entry.error}</p> : entry.result ? <CommandResultView result={entry.result} onGuide={name => { setDraft(`help ${name}`); input.current?.focus(); }}/>: <p className="command-wait">正在等待结果…</p>}</article>)}
    </div>
    <form className="command-composer" onSubmit={e => { e.preventDefault(); void submit(); }}><label aria-hidden="true">›</label><textarea ref={input} aria-label="输入 CShell 命令" value={draft} maxLength={60000} spellCheck={false} placeholder='tools / call 能力名 {"参数": "值"}' onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); void submit(); } }}/>
      {request ? <button type="button" title="停止等待，执行中的远端操作需检查结果" aria-label="停止等待" onClick={() => void window.cshell.commandCancel(request).catch(() => {})}><Square size={17}/></button> : <button type="submit" disabled={!draft.trim()} title="执行（Enter）" aria-label="执行命令"><ArrowUp size={18}/></button>}
      <small>Enter 执行 · Shift+Enter 换行</small>
    </form>
  </section>;
}
export function CommandResultView({ result, onGuide }: { result: CommandResult; onGuide?: (name: string) => void }) {
  if (result.kind === 'help') return <div className="command-help">{commandHelp.commands.map(([name, description]) => <div key={name}><code>{name}</code><span>{description}</span></div>)}</div>;
  if (result.kind === 'context') return <p>{result.title}{result.sessionId && <code> {result.sessionId}</code>}</p>;
  if (result.kind === 'catalog' && Array.isArray(result.value)) return <div className="command-catalog">{!result.value.length && <p>当前范围没有匹配的已授权能力。可检查 API 设置或选择机器会话。</p>}{(result.value as CapabilityContract[]).map((tool, i) => <details key={`${tool.id}-${i}`}><summary><code>{tool.name}</code><span>{tool.description}</span></summary><p>{tool.effects === 'write' ? '改变目标状态' : '读取信息'} · {tool.permission}</p><pre>{JSON.stringify(tool.inputSchema || tool.examples || tool, null, 2)}</pre>{onGuide && <button onClick={() => onGuide(tool.id)}>查看完整参数</button>}</details>)}</div>;
  return <ResultValue value={result.value}/>;
}
function ResultValue({ value }: { value: unknown }) {
  const images: { mimeType: string; dataBase64: string; width?: number; height?: number }[] = [];
  const text = JSON.stringify(value, (_key, v) => {
    if (v && typeof v === 'object' && ['image/jpeg', 'image/png'].includes(v.mimeType) && typeof v.dataBase64 === 'string' && v.dataBase64.length <= 2800000 && /^[A-Za-z0-9+/]*={0,2}$/.test(v.dataBase64)) {
      if (images.length < 4) images.push(v);
      return { ...v, dataBase64: '[图像显示在下方]' };
    }
    return v;
  }, 2) ?? String(value);
  return <><pre className="command-json">{text.length > 120000 ? text.slice(0, 120000) + '\n…内容较长，请缩小查询范围或用 CLI --out 保存完整结果。' : text}</pre>{images.map((im, i) => <img key={i} className="command-image" src={`data:${im.mimeType};base64,${im.dataBase64}`} alt={`目标画面 ${i + 1}`} />)}</>;
}
