import {ErrorNotice} from './ErrorNotice';
import {useState,useEffect} from 'react';
import type {AgentCall} from '../../shared/agent';
export function AgentAssistantSettings({call,onSaved,connectAccount}:{connectAccount?:()=>Promise<unknown>;onSaved?:()=>void;call:(method:AgentCall['method'],params?:unknown)=>Promise<any>}) {
 const [draft,setDraft]=useState<any>(),[key,setKey]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{let alive=true;call('assistant.settings').then(v=>{if(alive)setDraft(v)}).catch(e=>{if(alive)setError(String(e))});return()=>{alive=false}},[call]);
 return <form className="agent-form" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{setDraft(await call('assistant.configure',{providerId:draft.providerId,endpoint:draft.endpoint,model:draft.model,commands:draft.commands,review:draft.review,delegates:draft.delegates,...(key?{key}:{})}));setKey('');onSaved?.()}catch(e){setError(String(e))}finally{setBusy(false)}}}>
 <h3>模型与智能体</h3>{error&&<ErrorNotice title="操作未完成" error={error}/>}{draft&&<fieldset disabled={busy}>
 {connectAccount&&<section className="machine-chat-account"><strong>{draft.account?.email||'连接 CShell 账号'}</strong><p>将当前 CShell 账号登录到这台机器，云同步基座、会话和偏好，并共享会员额度。这台机器会保存加密登录凭据。</p><button type="button" onClick={async()=>{setBusy(true);setError('');try{await connectAccount();setDraft(await call('assistant.settings'));onSaved?.();}catch(error){setError(String(error));}finally{setBusy(false);}}}>{busy?'正在同步…':'同步当前 CShell 账号'}</button>{draft.account?.error&&<ErrorNotice title="云同步需要处理" error={draft.account.error}/>}</section>}
 {draft.providers?.length>0&&<label>云端基座<select value={draft.providerId??''} onChange={async e=>{setBusy(true);setError('');try{await call('assistant.provider.select',{providerId:e.target.value});setDraft(await call('assistant.settings'));setKey('');onSaved?.();}catch(error){setError(String(error));}finally{setBusy(false);}}}><option value="" disabled>选择基座</option>{draft.providers.map((provider:any)=><option value={provider.id} key={provider.id}>{provider.name}{provider.official?' · 账号额度':''}</option>)}</select></label>}
 <label>模型接口<input value={draft.endpoint} onChange={e=>setDraft({...draft,endpoint:e.target.value})}/></label>
 <label>模型名称<input value={draft.model} placeholder="填写服务商提供的模型名称" onChange={e=>setDraft({...draft,model:e.target.value})}/></label>
 <label>API Key<input type="password" value={key} placeholder={draft.keyConfigured?'已保存，留空保留':''} onChange={e=>setKey(e.target.value)}/></label>
 <label><input type="checkbox" checked={draft.commands} onChange={e=>setDraft({...draft,commands:e.target.checked})}/>允许执行命令</label>
 <label><input type="checkbox" checked={draft.review} onChange={e=>setDraft({...draft,review:e.target.checked})}/>执行前审核</label>
 <label>允许委派的控制端（* 表示所有已认证控制端）<textarea value={draft.delegates.join('\n')} onChange={e=>setDraft({...draft,delegates:e.target.value.split(/\s+/).filter(Boolean)})}/></label><button className="primary">{busy ? "正在保存…" : "保存"}</button></fieldset>}
 </form>
}
