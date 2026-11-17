import { useEffect, useState } from 'react';
import type { AgentCall } from '../../shared/agent';

type Call = (method: AgentCall['method'], params?: unknown) => Promise<unknown>;
type Entry = {id:string; title:string; excerpt:string; library:string; key:string};
export function MachineKnowledge({call}: {call:Call}) {
  const [library,setLibrary]=useState('default'), [key,setKey]=useState('general');
  const [title,setTitle]=useState(''), [content,setContent]=useState(''), [query,setQuery]=useState('');
  const [kind,setKind]=useState('text'), [entries,setEntries]=useState<Entry[]>([]);
  const [grants,setGrants]=useState<string[] | null>(null), [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState(''), [detail,setDetail]=useState('');
  useEffect(()=>{
    let active=true;
    call('packages.list').then(value=>{
      if(!active)return;
      const item=(value as {id:string;grants:string[]}[]).find(x=>x.id==='cagent.knowledge');
      if(!item)throw Error('请在这台机器的应用市场安装知识库');
      setGrants(item.grants);
    }).catch(e=>{if(active)setNotice(String(e));});
    return ()=>{active=false;};
  },[call]);
  const run=async(fn:()=>Promise<void>)=>{setBusy(true);setNotice('');try{await fn();}catch(e){setNotice(String(e));}finally{setBusy(false);}};
  const manual=(toolId:string,args:unknown)=>call('knowledge.manage',{toolId,args});
  const search=async()=>{const result=await manual('knowledge_search',{library,key,query}) as {records:Entry[]};setEntries(result.records);setDetail('');setNotice('找到 '+result.records.length+' 条记录（最多显示 30 条）');};
  const toggle=async(permission:string,checked:boolean)=>{
    const next=checked?[...grants??[],permission]:(grants??[]).filter(p=>p!==permission);
    const result=await call('packages.grant',{id:'cagent.knowledge',permissions:next}) as {grants:string[]};
    setGrants(result.grants);setNotice('智能体权限已保存');
  };
  return <section className="machine-knowledge"><fieldset disabled={busy||!grants}><legend>智能体访问</legend>
    {([['knowledge.read','为智能体提供知识支持（读取与检索）'],['knowledge.write','允许智能体写入知识和任务路径']]).map(([id,label])=><label key={id}><input type="checkbox" checked={grants?.includes(id)??false} onChange={e=>void run(()=>toggle(id,e.target.checked))}/>{label}</label>)}
  </fieldset><fieldset disabled={busy||!grants}><legend>知识记录</legend>
    <label>知识库<input value={library} onChange={e=>setLibrary(e.target.value)}/></label>
    <label>分类 key<input value={key} onChange={e=>setKey(e.target.value)}/></label>
    <label>关键词<input value={query} onChange={e=>setQuery(e.target.value)}/></label><button onClick={()=>void run(search)}>查询记录</button>
    {entries.map(row=><button key={row.id} onClick={()=>void run(async()=>{const result=await manual('knowledge_get',{library:row.library,key:row.key,id:row.id}) as {record:{content:string}};setDetail(result.record.content);})}>{row.title} · {row.excerpt}</button>)}{detail&&<pre>{detail}</pre>}
    <label>类型<select value={kind} onChange={e=>setKind(e.target.value)}><option value="text">文本</option><option value="json">结构化 JSON</option><option value="procedure">任务路径</option></select></label>
    <label>标题<input value={title} onChange={e=>setTitle(e.target.value)}/></label>
    <label>正文<textarea value={content} onChange={e=>setContent(e.target.value)} placeholder={kind==='procedure'?'{"steps":["操作步骤"],"outcome":"验证结果"}':undefined}/></label>
    <button disabled={!title.trim()||!content.trim()} onClick={()=>void run(async()=>{const r=await manual('knowledge_put',{library,key,kind,title,content}) as {vector:string;backup:string};setNotice('已保存'+(r.vector==='disabled'?'':' · 向量索引 '+r.vector)+(r.backup==='disabled'?'':' · 备份 '+r.backup));})}>保存知识</button>
  </fieldset><p role="status">{notice}</p></section>;
}
