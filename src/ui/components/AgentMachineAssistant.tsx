import {useEffect,useState} from 'react';
import type {AgentCall} from '../../shared/agent';
export function AgentMachineAssistant({call}:{call:(method:AgentCall['method'],params?:unknown)=>Promise<unknown>}){
 const [prompt,setPrompt]=useState(''),[tasks,setTasks]=useState<any[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{let alive=true,inflight=false;const refresh=async()=>{if(inflight)return;inflight=true;try{const result=await call('assistant.tasks');if(alive)setTasks(result as any[]);}catch(e){if(alive)setError(String(e));}finally{inflight=false;}};void refresh();const timer=setInterval(()=>void refresh(),3000);return()=>{alive=false;clearInterval(timer)};},[call]);
 return <section className="machine-assistant"><h3>这台机器的智能体</h3><form onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{await call('assistant.start',{prompt,requestId:crypto.randomUUID()});setPrompt('');setTasks(await call('assistant.tasks') as any[]);}catch(e){setError(String(e));}finally{setBusy(false);}}}><textarea aria-label="交给这台机器的任务" placeholder="交给这台机器的任务…" value={prompt} onChange={e=>setPrompt(e.target.value)} rows={4}/><button disabled={busy||!prompt.trim()}>提交任务</button></form>{error&&<p role="alert">{error}</p>}{tasks.map(t=><article key={t.id}><strong>{t.prompt}</strong><p>{t.answer||t.error||t.state}</p>{['running','approval','queued'].includes(t.state)&&<button onClick={()=>void call('assistant.cancel',{id:t.id}).catch(e=>setError(String(e)))}>停止此任务</button>}</article>)}</section>;
}

