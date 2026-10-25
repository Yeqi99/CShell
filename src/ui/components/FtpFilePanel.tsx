import {useCallback,useEffect,useRef,useState} from 'react';
import {ArrowUp,Check,Copy,Download,File,Folder,FolderPlus,Pencil,RefreshCw,Trash2,Upload,X} from 'lucide-react';
import type {FileEntry,Transfer} from '../../shared/contracts';

export function formatFileBytes(bytes:number):string {
  const value=Math.max(0,Number.isFinite(bytes)?bytes:0),units=['B','KiB','MiB','GiB','TiB'];
  const unit=Math.max(0,Math.min(units.length-1,Math.floor(Math.log2(value||1)/10)));
  return `${new Intl.NumberFormat('zh-CN',{maximumFractionDigits:unit?1:0}).format(value/1024**unit)} ${units[unit]}`;
}
const errorMessage=(error:unknown)=>(error instanceof Error?error.message:String(error)).replace(/^Error invoking remote method '[^']+': Error: /,'');

/** FTP deliberately exposes only the operations supported by its provider. */
export function FtpFilePanel({sessionId,closed,transfers}:{sessionId:string;closed:boolean;transfers:Transfer[]}) {
  const[path,setPath]=useState('.'),[draft,setDraft]=useState('.'),[entries,setEntries]=useState<FileEntry[]>([]),[selected,setSelected]=useState<string[]>([]);
  const[loading,setLoading]=useState(false),[working,setWorking]=useState(false),[error,setError]=useState('');
  const[action,setAction]=useState<'mkdir'|'rename'|'delete'|null>(null),[name,setName]=useState(''),[dropping,setDropping]=useState(false);
  const actionTarget=useRef<{path:string;entries:FileEntry[]}>({path:'.',entries:[]});
  const generation=useRef(0),mounted=useRef(true),offline=useRef(closed),operation=useRef(false),anchor=useRef<string|undefined>(undefined);
  offline.current=closed;
  const load=useCallback(async(next:string)=>{
    if(offline.current)return;const current=++generation.current;setLoading(true);setError('');
    try{const result=await window.cshell.list(sessionId,next);if(mounted.current&&!offline.current&&current===generation.current){setPath(result.path);setDraft(result.path);setEntries(result.entries);setSelected([]);anchor.current=undefined;}}
    catch(reason){if(mounted.current&&!offline.current&&current===generation.current)setError(errorMessage(reason));}
    finally{if(mounted.current&&current===generation.current)setLoading(false);}
  },[sessionId]);
  useEffect(()=>{mounted.current=true;void load('.');return()=>{mounted.current=false;generation.current++;};},[load]);
  useEffect(()=>{if(closed){generation.current++;setLoading(false);setDropping(false);}},[closed]);
  const completed=transfers.filter(item=>item.state==='done').length;
  const previousCompleted=useRef(completed);
  useEffect(()=>{if(completed>previousCompleted.current&&!closed)void load(path);previousCompleted.current=completed;},[completed,closed,load,path]);
  const run=async(task:()=>Promise<unknown>)=>{
    if(offline.current||operation.current)return;operation.current=true;setWorking(true);setError('');
    try{await task();}catch(reason){if(mounted.current)setError(errorMessage(reason));}
    finally{operation.current=false;if(mounted.current)setWorking(false);}
  };
  const chosen=entries.filter(entry=>selected.includes(entry.path)),downloadable=chosen.length>0&&chosen.every(entry=>!entry.directory&&!entry.symlink);
  const choose=(entry:FileEntry,range:boolean,toggle:boolean)=>{
    if(range&&anchor.current){const start=entries.findIndex(item=>item.path===anchor.current),end=entries.indexOf(entry);if(start>=0){setSelected(entries.slice(Math.min(start,end),Math.max(start,end)+1).map(item=>item.path));return;}}
    anchor.current=entry.path;setSelected(current=>toggle?current.includes(entry.path)?current.filter(path=>path!==entry.path):[...current,entry.path]:[entry.path]);
  };
  const begin=(value:'mkdir'|'rename'|'delete')=>{actionTarget.current={path,entries:chosen};setAction(value);setName(value==='rename'?chosen[0]?.name??'':'');};
  const submit=()=>void run(async()=>{
    if(action==='delete'){
      for(const entry of actionTarget.current.entries){if(offline.current)throw Error('连接已断开');await window.cshell.fileAction(sessionId,'delete',entry.path);}
    }else{
      if(!name||/[\\/\0\r\n]/.test(name)||name==='.'||name==='..')throw Error('名称不能为空，也不能包含斜杠或换行。');
      const destination=`${actionTarget.current.path.replace(/\/$/,'')}/${name}`;
      if(action==='mkdir')await window.cshell.fileAction(sessionId,'mkdir',destination);
      else if(action==='rename'&&actionTarget.current.entries.length===1)await window.cshell.fileAction(sessionId,'rename',actionTarget.current.entries[0].path,destination);
      else throw Error('请重新选择一个文件或目录。');
    }
    if(!mounted.current)return;setAction(null);setName('');await load(path);
  });
  const busy=loading||working||closed;
  return <section className={'ftp-file-panel'+(dropping?' drop-active':'')} aria-label="FTP 文件"
    onKeyDown={event=>{if(event.key==='Escape'){setAction(null);setDropping(false);}}}
    onDragOver={event=>{if(!busy&&event.dataTransfer.types.includes('Files')){event.preventDefault();event.dataTransfer.dropEffect='copy';setDropping(true);}}}
    onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setDropping(false);}}
    onDrop={event=>{event.preventDefault();setDropping(false);if(busy||!event.dataTransfer.files.length)return;const files=Array.from(event.dataTransfer.files);void run(()=>window.cshell.upload(sessionId,path,window.cshell.droppedFiles(files)));}}>
    <div className="ftp-path-bar"><button className="icon" aria-label="上级目录" title="上级目录" disabled={busy} onClick={()=>void load(path+'/..')}><ArrowUp size={16}/></button>
      <form onSubmit={event=>{event.preventDefault();if(!busy)void load(draft);}}><input aria-label="路径" value={draft} disabled={closed} onChange={event=>setDraft(event.target.value)}/></form>
      <button className="icon" aria-label="刷新目录" title="刷新目录" disabled={busy} onClick={()=>void load(path)}><RefreshCw size={16} className={loading?'spin':''}/></button>
      <button className="icon" aria-label="复制路径" title="复制路径" disabled={closed} onClick={()=>void run(()=>window.cshell.copyText(path))}><Copy size={15}/></button></div>
    <div className="ftp-actions" role="toolbar" aria-label="文件操作">
      <button disabled={busy} onClick={()=>void run(()=>window.cshell.upload(sessionId,path))}><Upload size={15}/>上传文件</button>
      <button disabled={busy||!downloadable} title={chosen.some(entry=>entry.directory)?'FTP 仅支持下载文件，请先进入目录选择文件':'下载所选文件'} onClick={()=>void run(()=>window.cshell.download(sessionId,chosen.map(entry=>entry.path)))}><Download size={15}/>下载</button>
      <button className="icon" aria-label="新建目录" title="新建目录" disabled={busy} onClick={()=>begin('mkdir')}><FolderPlus size={16}/></button>
      <button className="icon" aria-label="重命名" title="重命名" disabled={busy||chosen.length!==1} onClick={()=>begin('rename')}><Pencil size={15}/></button>
      <button className="icon" aria-label="删除" title="删除所选文件或空目录" disabled={busy||!chosen.length} onClick={()=>begin('delete')}><Trash2 size={15}/></button>
    </div>
    {error&&<div className="file-inline-error" role="alert"><span>{error}</span><button disabled={busy} onClick={()=>void load(path)}>刷新目录</button></div>}
    <div className="ftp-file-head" aria-hidden="true"><span>名称</span><span>大小</span><span>修改时间</span></div>
    <div className="ftp-file-list" role="listbox" aria-label="文件列表" aria-multiselectable="true" aria-busy={loading} tabIndex={0} onKeyDown={event=>{
      if(busy)return;if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='a'){event.preventDefault();setSelected(entries.map(entry=>entry.path));}
      if(event.key==='Delete'&&chosen.length){event.preventDefault();begin('delete');}
      if(event.key==='F2'&&chosen.length===1){event.preventDefault();begin('rename');}
    }}>
      {entries.map(entry=><div role="option" aria-selected={selected.includes(entry.path)} tabIndex={busy?-1:0} className={'ftp-file-row'+(selected.includes(entry.path)?' selected':'')} key={entry.path}
        onClick={event=>{if(!busy)choose(entry,event.shiftKey,event.ctrlKey||event.metaKey);}}
        onDoubleClick={()=>{if(busy)return;if(entry.directory)void load(entry.path);else if(!entry.symlink)void run(()=>window.cshell.download(sessionId,[entry.path]));}}
        onKeyDown={event=>{if(busy)return;if(event.key===' '){event.preventDefault();choose(entry,event.shiftKey,true);}if(event.key==='Enter'){event.preventDefault();entry.directory?void load(entry.path):choose(entry,false,false);}if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();const sibling=event.key==='ArrowDown'?event.currentTarget.nextElementSibling:event.currentTarget.previousElementSibling;if(sibling instanceof HTMLElement&&sibling.getAttribute('role')==='option')sibling.focus();}}}>
        <span className="ftp-file-name">{selected.includes(entry.path)?<Check size={15}/>:entry.directory?<Folder size={16}/>:<File size={15}/>}<span title={entry.name}>{entry.name}{entry.symlink?' ↗':''}</span></span>
        <span>{entry.directory?'—':formatFileBytes(entry.size)}</span><time dateTime={entry.modified>0&&Number.isFinite(new Date(entry.modified).getTime())?new Date(entry.modified).toISOString():undefined}>{entry.modified>0&&Number.isFinite(new Date(entry.modified).getTime())?new Date(entry.modified).toLocaleDateString('zh-CN'):'—'}</time>
      </div>)}
      {!entries.length&&<p className="empty-small">{loading?'正在读取目录…':error?'目录未能载入':'此目录为空'}</p>}
    </div>
    <footer className="ftp-summary"><span>{entries.length} 项{chosen.length?` · 已选 ${chosen.length} 项`:''}</span><span>支持拖入文件上传</span></footer>
    {action&&<form className="ftp-inline-action" aria-label={action==='mkdir'?'新建目录':action==='rename'?'重命名':'确认删除'} onSubmit={event=>{event.preventDefault();if(!busy)submit();}}>
      {action==='delete'?<p>删除选中的 {actionTarget.current.entries.length} 项？目录必须为空；此操作不能撤销。</p>:<label>{action==='mkdir'?'目录名称':'新名称'}<input autoFocus required value={name} disabled={busy} onChange={event=>setName(event.target.value)}/></label>}
      <div><button type="button" disabled={working} onClick={()=>setAction(null)}><X size={14}/>取消</button><button className={action==='delete'?'danger':'primary'} disabled={busy}>{action==='delete'?'确认删除':'保存'}</button></div>
    </form>}
  </section>;
}
