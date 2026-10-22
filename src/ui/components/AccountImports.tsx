import {useEffect,useState} from 'react';
import {ArrowLeft,FolderInput,ChevronRight} from 'lucide-react';
import type {AccountSource,AccountSourcePreview} from '../../shared/account-import';
import './account-imports.css';
const titles={opensource:'CShell 开源版',guest:'Pro 未登录工作区'};
export function AccountImports(){
 const [sources,setSources]=useState<AccountSource[]>([]),[preview,setPreview]=useState<AccountSourcePreview>();
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[settings,setSettings]=useState(false);
 const [choices,setChoices]=useState<Record<string,'account'|'source'>>({});
 const [clear,setClear]=useState(false);
 useEffect(()=>{let alive=true;void window.cshell.accountSources?.().then(value=>{if(alive)setSources(value);}).catch(()=>{if(alive)setError('本机配置检查暂未完成，可稍后重新进入此页。');});return()=>{alive=false;};},[]);
 const run=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');setMessage('');try{await fn();}catch(e){setError(String((e as Error).message).replace(/^Error invoking remote method '[^']+': (?:Error: )?/,''));}finally{setBusy(false);}};
 if(!window.cshell.accountSources||(!sources.length&&!error&&!message))return null;
 return <section className="account-section account-imports" aria-label="本机配置">
  <div className="import-heading"><h2>本机配置</h2><span>由你选择载入</span></div>
  {!preview?<><p className="import-description">发现其他工作区的配置。查看后再决定是否加入当前账号，原配置会保留。</p><div className="import-sources">{sources.map(source=><button disabled={busy} key={source} onClick={()=>void run(async()=>{const result=await window.cshell.accountSourcePreview!(source);setPreview(result);setChoices({});setSettings(false);})}><FolderInput size={18}/><span><strong>{titles[source]}</strong><small>{busy?'正在检查…':'查看连接、模型与扩展配置'}</small></span><ChevronRight size={16}/></button>)}</div></>:<div className="import-review">
   <button className="auth-link import-back" disabled={busy} onClick={()=>setPreview(undefined)}><ArrowLeft size={14}/>返回来源</button>
   <h3>{titles[preview.source]}</h3><div className="import-counts">{preview.counts.map(c=><span key={c.label}><strong>{c.count}</strong>{c.label}</span>)}</div>
   <label className="import-settings"><input type="checkbox" checked={settings} disabled={busy} onChange={e=>setSettings(e.target.checked)}/>同时使用此来源的外观、扩展偏好和默认模型</label>
   {!!preview.conflicts.length&&<div className="import-conflicts"><h4>以下条目不同，请选择保留哪一份</h4>{preview.conflicts.map(c=><label key={c.id}><span><strong>{c.name}</strong><small>{c.category}</small></span><select aria-label={`${c.category} ${c.name} 保留方式`} disabled={busy} value={choices[c.id]??''} onChange={e=>setChoices({...choices,[c.id]:e.target.value as 'account'|'source'})}><option value="" disabled>选择保留方式</option><option value="account">当前账号</option><option value="source">本机来源</option></select></label>)}</div>}
   <p className="import-description">确认后载入并自动同步。访问权限、浏览器登录状态和应用安装状态不会迁移。</p>
   <div className="import-actions"><button disabled={busy} onClick={()=>setPreview(undefined)}>暂不载入</button><button className="primary" disabled={busy||preview.conflicts.some(c=>!choices[c.id])} onClick={()=>void run(async()=>{await window.cshell.accountSourceImport!(preview.token,settings,choices);setPreview(undefined);setMessage('已载入当前账号，云同步会自动继续。');})}>{busy?'正在处理…':'载入当前账号'}</button></div>
  </div>}
  {!preview&&sources.includes('guest')&&<div className="import-clear">{!clear?<button className="auth-link" disabled={busy} onClick={()=>setClear(true)}>清除未登录数据…</button>:<><h3>清除 Pro 未登录工作区？</h3><p className="import-description">将删除未登录时保存的连接及凭据、模型、习惯记忆、扩展配置、外观和浏览器数据。当前账号、云端数据、开源版原配置及设备身份会保留。此操作无法撤销。</p><div className="import-actions"><button disabled={busy} onClick={()=>setClear(false)}>取消</button><button disabled={busy} onClick={()=>void run(async()=>{await window.cshell.guestCacheClear!('clear-guest-local-only');setClear(false);setSources(await window.cshell.accountSources!());setMessage('未登录工作区的数据已清除。');})}>确认清除未登录数据</button></div></>}</div>}
  {error&&<p className="account-feedback" role="alert">{error}</p>}{message&&<p className="import-description" role="status">{message}</p>}
 </section>;
}
