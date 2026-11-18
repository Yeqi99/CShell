import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,BookOpen,ChevronRight,Database,FileText,ListChecks,MessageCircle,Plus,Search,Settings2} from 'lucide-react';
import type {AgentCall} from '../../shared/agent';
import './machine-knowledge.css';

type Call=(method:AgentCall['method'],params?:unknown)=>Promise<unknown>;
type Entry={id:string;title:string;excerpt:string;library:string;key:string;kind:string;content?:string;source?:string};
const formats={
  article:{label:'文章',icon:FileText,title:'标题',body:'正文'},
  qa:{label:'问答',icon:MessageCircle,title:'问题',body:'答案'},
  procedure:{label:'解题经验',icon:ListChecks,title:'解决的问题',body:'解决思路'},
  kv:{label:'键值',icon:Database,title:'键名',body:'值'},
  json:{label:'JSON',icon:Database,title:'标题',body:'JSON 正文'}
};
type Format=keyof typeof formats;
const blank={title:'',body:'',steps:'',outcome:'',source:''};

function fields(row:Entry):[string,string][] {
  const raw=row.content??'';
  try{
    const v=JSON.parse(raw);
    if(row.kind==='json'&&v?.format==='cshell.qa')return [['答案',v.answer]];
    if(row.kind==='json'&&v?.format==='cshell.kv')return [['值',v.value]];
    if(row.kind==='procedure')return [['解决思路',v.approach??''],['操作步骤',v.steps.join('\n')],['验证结果',v.outcome]].filter((f):f is [string,string]=>!!f[1]);
  }catch{/* Older text records are displayed verbatim. */}
  return [[row.kind==='json'?'JSON 正文':'正文',raw]];
}
export function MachineKnowledge({call}:{call:Call}){
  const [library,setLibrary]=useState('default'),[key,setKey]=useState('general'),[query,setQuery]=useState('');
  const [format,setFormat]=useState<Format>('article'),[draft,setDraft]=useState(blank);
  const [entries,setEntries]=useState<Entry[]>([]),[detail,setDetail]=useState<Entry>(),[edit,setEdit]=useState(false);
  const [grants,setGrants]=useState<string[]>(),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState('');
  const [scope,setScope]=useState(false),[access,setAccess]=useState(false);
  const manual=(toolId:string,args:unknown)=>call('knowledge.manage',{toolId,args});
  const sequence=useRef(0);
  useEffect(()=>{
    let alive=true;call('packages.list').then(v=>{
      if(!alive)return;
      const item=(v as {id:string;grants:string[]}[]).find(x=>x.id==='cagent.knowledge');
      if(!item)throw Error('请在这台机器的应用市场安装知识库');
      setGrants(item.grants);
    }).catch(e=>{if(alive)setError(String(e))});
    return ()=>{alive=false};
  },[call]);
  const [revision,refresh]=useState(0);
  useEffect(()=>{
    const id=++sequence.current;
    const timer=setTimeout(async()=>{
      try{
        const result=await call('knowledge.manage',{toolId:'knowledge_search',args:{library:library.trim()||undefined,key:key.trim()||undefined,query}}) as {records:Entry[]};
        if(id===sequence.current){setEntries(result.records);setError('');}
      }catch(e){if(id===sequence.current){setEntries([]);setError(String(e));}}
    },180);
    return ()=>{clearTimeout(timer);sequence.current++;};
  },[call,library,key,query,revision]);
  async function run(fn:()=>Promise<void>){setBusy(true);setError('');setNotice('');try{await fn();}catch(e){setError(String(e));}finally{setBusy(false);}}
  async function save(){
    const type=format==='article'?'text':format==='procedure'?'procedure':'json';
    let content=draft.body;
    if(format==='qa')content=JSON.stringify({format:'cshell.qa',question:draft.title,answer:draft.body});
    if(format==='kv')content=JSON.stringify({format:'cshell.kv',key:draft.title,value:draft.body});
    if(format==='procedure')content=JSON.stringify({approach:draft.body,steps:draft.steps.split('\n').map(x=>x.trim()).filter(Boolean),outcome:draft.outcome});
    const r=await manual('knowledge_put',{library:library.trim()||'default',key:key.trim()||'general',kind:type,title:draft.title.trim(),content,source:draft.source.trim()||undefined}) as {stored:boolean;id:string;error?:string;vector?:string;backup?:string};
    if(!r.stored)throw Error(r.error||'保存未完成');
    setEdit(false);setDraft(blank);setQuery('');refresh(n=>n+1);setNotice('已保存'+(r.vector && !['indexed','disabled'].includes(r.vector)?'，向量索引待补建':'')+(r.backup && !['uploaded','disabled'].includes(r.backup)?'，备份待同步':''));
  }
  const selected=formats[format],allowed=!!grants&&!busy;
  const input=(name:keyof typeof blank,label:string,multiline=false)=> <label>{label}{multiline?<textarea value={draft[name]} onChange={e=>setDraft({...draft,[name]:e.target.value})}/>:<input maxLength={name==='title'?160:1000} value={draft[name]} onChange={e=>setDraft({...draft,[name]:e.target.value})}/>}</label>;
  return <section className="machine-knowledge kb-workspace" aria-label="机器知识库">
    <header><div><BookOpen size={21}/><h2>知识库</h2></div><button aria-label="智能体访问权限" title="智能体访问权限" aria-expanded={access} onClick={()=>setAccess(!access)}><Settings2 size={16}/></button></header>
    {access&&<div className="kb-access">{[['knowledge.read','允许智能体读取与检索'],['knowledge.write','允许智能体写入经验']].map(([id,label])=><label key={id}><input type="checkbox" disabled={!allowed} checked={grants?.includes(id)??false} onChange={e=>{const next=e.target.checked?[...grants!,id]:grants!.filter(x=>x!==id);void run(async()=>{const r=await call('packages.grant',{id:'cagent.knowledge',permissions:next}) as {grants:string[]};setGrants(r.grants);setNotice('智能体权限已保存');});}}/>{label}</label>)}</div>}
    {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {edit?<form onSubmit={e=>{e.preventDefault();if(allowed)void run(save);}}>
      <button type="button" disabled={busy} onClick={()=>setEdit(false)}><ArrowLeft size={15}/>返回列表</button>
      <h3>添加知识</h3><fieldset disabled={!allowed}><label>知识类型<select value={format} onChange={e=>setFormat(e.target.value as Format)}>{Object.entries(formats).map(([id,f])=><option key={id} value={id}>{f.label}</option>)}</select></label>
      {input('title',selected.title)}{input('body',selected.body,true)}{format==='procedure'&&<>{input('steps','操作步骤（每行一步）',true)}{input('outcome','验证结果')}</>}{input('source','来源（选填）')}
      <footer><small>{library||'default'} / {key||'general'}</small><button className="primary" disabled={!draft.title.trim()||!draft.body.trim()||format==='procedure'&&(!draft.steps.trim()||!draft.outcome.trim())}>{busy?'正在保存…':'保存知识'}</button></footer></fieldset></form>
    :detail?<article><button onClick={()=>setDetail(undefined)}><ArrowLeft size={15}/>返回列表</button><h3>{detail.title}</h3><small>{detail.library} / {detail.key}{detail.source&&' · '+detail.source}</small>{fields(detail).map(([label,text])=><div key={label}><h4>{label}</h4><pre>{text}</pre></div>)}</article>
    :<><div className="kb-tools"><label><Search size={16}/><input aria-label="搜索知识" placeholder="搜索问题、标题或关键词" value={query} onChange={e=>setQuery(e.target.value)}/></label><button onClick={()=>setScope(!scope)} aria-expanded={scope}>范围</button><button className="primary" disabled={!allowed} onClick={()=>{setEdit(true);setNotice('');}}><Plus size={16}/>添加知识</button></div>
    {scope&&<div className="kb-scope"><label>知识库<input value={library} onChange={e=>setLibrary(e.target.value)}/></label><label>分类<input value={key} onChange={e=>setKey(e.target.value)}/></label></div>}
    <div className="kb-list">{entries.length?entries.map(row=><button disabled={busy} key={row.id} onClick={()=>void run(async()=>{const r=await manual('knowledge_get',{library:row.library,key:row.key,id:row.id}) as {record:Entry|null};if(!r.record)throw Error('记录已不存在');setDetail(r.record);})}><FileText size={18}/><span><strong>{row.title}</strong><small>{row.library} / {row.key}</small></span><ChevronRight size={15}/></button>):<p>{error?'无法读取知识记录':!grants?'正在读取知识库…':query?'没有匹配的记录':'当前分类暂无知识'}</p>}</div></>}
  </section>;
}
