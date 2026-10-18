import {useState,useEffect} from 'react';
import type {AgentCall} from '../../shared/agent';
export function AgentAssistantSettings({call}:{call:(method:AgentCall['method'],params?:unknown)=>Promise<any>}) {
 const [draft,setDraft]=useState<any>(),[key,setKey]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{let alive=true;call('assistant.settings').then(v=>{if(alive)setDraft(v)}).catch(e=>{if(alive)setError(String(e))});return()=>{alive=false}},[call]);
 return <form className="agent-form" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{setDraft(await call('assistant.configure',{endpoint:draft.endpoint,model:draft.model,commands:draft.commands,review:draft.review,delegates:draft.delegates,...(key?{key}:{})}));setKey('')}catch(e){setError(String(e))}finally{setBusy(false)}}}>
 <h3>模型与智能体</h3>{error&&<p role="alert">{error}</p>}{draft&&<fieldset disabled={busy}>
 <label>模型接口<input value={draft.endpoint} onChange={e=>setDraft({...draft,endpoint:e.target.value})}/></label>
 <label>模型名称<input value={draft.model} placeholder="填写服务商提供的模型名称" onChange={e=>setDraft({...draft,model:e.target.value})}/></label>
 <label>API Key<input type="password" value={key} placeholder={draft.keyConfigured?'已保存，留空保留':''} onChange={e=>setKey(e.target.value)}/></label>
 <label><input type="checkbox" checked={draft.commands} onChange={e=>setDraft({...draft,commands:e.target.checked})}/>允许执行命令</label>
 <label><input type="checkbox" checked={draft.review} onChange={e=>setDraft({...draft,review:e.target.checked})}/>执行前审核</label>
 <label>允许委派的控制端（* 表示所有已认证控制端）<textarea value={draft.delegates.join('\n')} onChange={e=>setDraft({...draft,delegates:e.target.value.split(/\s+/).filter(Boolean)})}/></label><button>保存</button></fieldset>}
 </form>
}
