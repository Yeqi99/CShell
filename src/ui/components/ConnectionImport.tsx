import { useEffect, useRef, useState } from 'react';
import { FileUp, ListChecks, ArrowLeft } from 'lucide-react';
import type { ConnectionImportPreview } from '../../core/connection-import';
import type { ImportColumn } from '../../shared/connection-batch';
import { ErrorNotice } from './ErrorNotice';
import './connection-import.css';
const columns: [ImportColumn, string][] = [['host','地址'],['port','端口'],['username','用户名'],['password','密码'],['name','名称'],['group','分组'],['protocol','协议']];
export function ConnectionImport({ onSaved, onBack }: { onSaved: () => Promise<void>; onBack: () => void }) {
  const [preview, setPreview] = useState<ConnectionImportPreview>();
  const [text, setText] = useState('');
  const [delimiter, setDelimiter] = useState<',' | ';' | '\t'>(',');
  const [mapping, setMapping] = useState<Partial<Record<ImportColumn, number>>>({});
  const [username, setUsername] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  const [policy, setPolicy] = useState<'skip' | 'keep'>('skip');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [result, setResult] = useState('');
  const [changed, setChanged] = useState(false), [page, setPage] = useState(0);
  const token = useRef('');
  useEffect(() => () => { if (token.current) void window.cshell.connectionImportDiscard?.(token.current); }, []);
  const accept = (value: ConnectionImportPreview) => {
    if (token.current && token.current !== value.token) void window.cshell.connectionImportDiscard?.(token.current);
    token.current = value.token;
    setPreview(value); setMapping(value.mapping); setSelected(value.rows.filter(row => !row.error).map(row => row.row));
    setChanged(false); setPage(0); setResult('');
  };
  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await fn(); } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const apply = () => run(async () => {
    if (!preview || changed) return;
    const value = await window.cshell.connectionImportApply!(preview.token, selected, policy);
    token.current = ''; setPreview(undefined); setText('');
    setResult(`已导入 ${value.imported.length} 条连接，跳过 ${value.skipped} 条重复记录。`);
    await onSaved();
  });
  return <section className="batch-import">
    <button className="batch-back" disabled={busy} onClick={onBack}><ArrowLeft size={15}/>返回新建连接</button>
    <header><ListChecks size={23}/><div><h1>批量导入连接</h1><p>选择 CSV 文件，或粘贴包含多个 SSH / RDP 地址的文本。</p></div></header>
    {error && <ErrorNotice title="导入未完成" error={error}/>}
    {result && <p className="batch-result" role="status">{result}</p>}
    <fieldset disabled={busy}>
      {!preview ? <>
        <div className="batch-file"><button onClick={() => void run(async () => { const value = await window.cshell.connectionImportFile!(delimiter); if (value) { setUsername(''); accept(value); } })}><FileUp size={17}/>选择 CSV 文件</button><label>分隔符<select value={delimiter} onChange={e => setDelimiter(e.target.value as typeof delimiter)}><option value=",">逗号</option><option value=";">分号</option><option value={'\t'}>制表符</option></select></label></div>
        <label className="batch-text">连接文本<textarea aria-label="批量连接文本" rows={7} spellCheck={false} value={text} onChange={e => setText(e.target.value)} placeholder={'ssh root@server-one -p 22\nssh user@server-two'}/></label>
        <div className="batch-actions"><small>在本机解析，不发送给智能体。下一步先预览，不会自动连接。</small><button className="primary" disabled={!text.trim()} onClick={() => void run(async () => { setUsername(''); accept(await window.cshell.connectionImportText!(text)); setText(''); })}>预览连接</button></div>
      </> : <>
        {preview.headers.length > 0 && <details open={!preview.rows.length}><summary>CSV 列对应关系</summary><div className="batch-mapping">{columns.map(([key, label]) => <label key={key}>{label}<select aria-label={label + '列'} value={mapping[key] ?? ''} onChange={e => { const next = { ...mapping }; if (e.target.value === '') delete next[key]; else next[key] = Number(e.target.value); setMapping(next); setChanged(true); }}><option value="">未指定</option>{preview.headers.map((header, i) => <option key={i} value={i}>{i + 1}. {header || '空表头'}</option>)}</select></label>)}</div></details>}
        <div className="batch-options"><label>缺失时使用的用户名<input value={username} onChange={e => { setUsername(e.target.value); setChanged(true); }} placeholder="不自动猜测用户名"/></label><button disabled={!changed} onClick={() => void run(async () => accept(await window.cshell.connectionImportPreview!(preview.token, { mapping, username })))}>更新预览</button><label>重复连接<select value={policy} onChange={e => setPolicy(e.target.value as typeof policy)}><option value="skip">跳过重复项</option><option value="keep">另存为新连接</option></select></label></div>
        <div className="batch-summary"><label><input type="checkbox" checked={selected.length > 0 && selected.length === preview.rows.filter(r => !r.error).length} onChange={e => setSelected(e.target.checked ? preview.rows.filter(r => !r.error).map(r => r.row) : [])}/>选择所有有效记录</label><span>{preview.rows.length} 条 · 已选 {selected.length} 条</span></div>
        <div className="batch-table"><table><thead><tr><th>选择</th><th>连接</th><th>地址</th><th>认证</th><th>状态</th></tr></thead><tbody>{preview.rows.slice(page * 50, (page + 1) * 50).map(row => <tr key={row.row}><td><input type="checkbox" aria-label={`选择第 ${row.row} 行`} disabled={!!row.error} checked={selected.includes(row.row)} onChange={e => setSelected(v => e.target.checked ? [...v, row.row] : v.filter(n => n !== row.row))}/></td><td>{row.name || `第 ${row.row} 行`}<small>{row.group}</small></td><td>{row.host}{row.port ? ':' + row.port : ''}<small>{row.protocol?.toUpperCase()}</small></td><td>{row.username || '—'}<small>{row.hasPassword ? '已包含密码' : '连接时补充认证'}</small></td><td>{row.error || (row.duplicate ? '重复连接' : '可导入')}</td></tr>)}</tbody></table></div>
        {preview.rows.length > 50 && <div className="batch-pages"><button disabled={!page} onClick={() => setPage(page - 1)}>上一页</button><span>{page + 1} / {Math.ceil(preview.rows.length / 50)}</span><button disabled={(page + 1) * 50 >= preview.rows.length} onClick={() => setPage(page + 1)}>下一页</button></div>}
        <div className="batch-actions"><button onClick={() => { void window.cshell.connectionImportDiscard!(preview.token); token.current = ''; setPreview(undefined); }}>重新选择来源</button><button className="primary" disabled={changed || !selected.length} onClick={() => void apply()}>{busy ? '正在导入…' : `确认导入 ${selected.length} 条`}</button></div>
      </>}
    </fieldset>
  </section>;
}
