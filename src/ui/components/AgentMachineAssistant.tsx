import {CloudConversationHistory} from './CloudConversationHistory';
import type {ChatDocument,ChatBridge} from '../../shared/cloud-conversations';
import {useRef} from 'react';
import { submitsComposer } from '../composer-keys';
import { ErrorNotice } from './ErrorNotice';
import {useEffect,useState} from 'react';
import {Bot,History,Plus,Settings,Send,Square,ArrowLeft,Server} from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {AgentCall} from '../../shared/agent';
import {AgentAssistantSettings} from './AgentAssistantSettings';
import {AiStreamingMarkdown} from './AiStreamingMarkdown';
import './machine-assistant.css';
type ModelSettings={model:string;providerId?:string;review:boolean;keyConfigured:boolean;providers?:{id:string;name:string;model:string;official:boolean}[]};
type Task={imported?:ChatDocument;conversationId?:string;id:string;prompt:string;answer:string;error?:string;state:string;createdAt?:string;events?:{tool:string;input:unknown;output?:string}[]};
const states:Record<string,string>={running:'正在执行',approval:'等待在目标机器的 CAgent 中确认',queued:'等待执行',completed:'已完成',failed:'执行失败',cancelled:'已停止',interrupted:'已中断'};
const running=(task?:Task)=>!!task&&['running','approval','queued'].includes(task.state);
export function AgentMachineAssistant({call,name='当前机器',active=true,mobile=false,cloud,connectAccount}:{connectAccount?:()=>Promise<unknown>;cloud?:ChatBridge;active?:boolean;mobile?:boolean;name?:string;call:(method:AgentCall['method'],params?:unknown)=>Promise<unknown>}){
 const [drafts,setDrafts]=useState<Record<string,string>>({}),[selected,setSelected]=useState(''),[tasks,setTasks]=useState<Task[]>([]),[error,setError]=useState(''),[refreshError,setRefreshError]=useState(''),[busy,setBusy]=useState(false),[stopping,setStopping]=useState(''),[history,setHistory]=useState(false),[settings,setSettings]=useState(false),[model,setModel]=useState<ModelSettings>(),[loaded,setLoaded]=useState(false);
 const [imported,setImported]=useState<ChatDocument>();
 const [cloudShown,showCloud]=useState(false),[cloudId,setCloudId]=useState('');
 const feed=useRef<HTMLDivElement>(null),follow=useRef(true);
 const grouped=new Map<string,Task[]>();
 for(const row of tasks){const key=row.conversationId??row.id;grouped.set(key,[...(grouped.get(key)??[]),row]);}
 const docs:ChatDocument[]=[...grouped.entries()].filter(([,rows])=>!running(rows.at(-1))).map(([id,rows])=>({id,title:rows[0].prompt.slice(0,120),target:name,messages:[...(rows[0].imported?.messages??[]),...rows.flatMap(r=>[{role:'user' as const,text:r.prompt},...(r.answer?[{role:'assistant' as const,text:r.answer}]:[])])]}));
 const [toolDetails,setToolDetails]=useState<Task>();
 const task=tasks.find(t=>t.id===selected),prompt=drafts[selected]??'';
 const turns=task?grouped.get(task.conversationId??task.id)??[]:[];
 useEffect(()=>{if(follow.current&&feed.current)feed.current.scrollTop=feed.current.scrollHeight;},[selected,task?.answer,task?.state]);
 const loadModel=()=>call('assistant.settings').then(v=>setModel(v as typeof model)).catch(()=>setModel(undefined));
 useEffect(()=>{void loadModel();},[call]);
 useEffect(()=>{if(!active)return;let alive=true,working=false,timer:ReturnType<typeof setTimeout>;const refresh=async()=>{try{const result=await call('assistant.tasks',mobile?{compact:true}:{}) as Task[];if(alive){working=result.some(running);setTasks(result);setRefreshError('');setLoaded(true);}}catch(e){working=false;if(alive)setRefreshError(String(e));}finally{if(alive)timer=setTimeout(()=>void refresh(),working?(mobile?650:350):3000);}};void refresh();return()=>{alive=false;clearTimeout(timer)};},[call,active]);
 const submit=async()=>{if(busy||!prompt.trim()||tasks.some(running))return;const source=selected,text=prompt;setBusy(true);setError('');try{const result=await call('assistant.start',{...(source?{resumeId:source}:imported?{history:imported}:{}),requestId:crypto.randomUUID(),prompt:text.trim()}) as {id:string};setDrafts(v=>({...v,[source]:v[source]===text?'':v[source]}));follow.current=true;setImported(undefined);setSelected(result.id);setTasks(await call('assistant.tasks',mobile?{compact:true}:{}) as Task[]);}catch(e){setError(String(e));}finally{setBusy(false);}};
 const stop=async(id:string)=>{setStopping(id);setError('');try{await call('assistant.cancel',{id});setTasks(await call('assistant.tasks',mobile?{compact:true}:{}) as Task[]);}catch(e){setError(String(e));}finally{setStopping('');}};
 return <section className="machine-chat" aria-label={name+'的智能体'}>
  <header className="machine-chat-header"><button title="任务历史" aria-label="任务历史" aria-expanded={history} onClick={()=>{setHistory(!history);setSettings(false);}}><History size={17}/></button><div><strong>智能体</strong><small title={name}><Server size={12}/><span>{name}</span></small></div><span className="machine-chat-spacer"/><button title="新任务" aria-label="新任务" onClick={()=>{setSelected('');setImported(undefined);setSettings(false);}}><Plus size={17}/></button><button title="模型与权限" aria-label="模型与权限" aria-expanded={settings} onClick={()=>{setSettings(!settings);setHistory(false);}}><Settings size={17}/></button></header>
  {active&&<CloudConversationHistory bridge={(cloud??window.cshell.cloudConversations)!} documents={docs} shown={cloudShown} selected={cloudId} onClose={()=>showCloud(false)} onContinue={async d=>{setSelected('');setImported(d);showCloud(false);setHistory(false);}}/>}
  <div className="machine-chat-body">
   {history&&<aside className="machine-chat-history" aria-label="任务历史列表"><strong>任务历史</strong><button onClick={()=>{setCloudId('');showCloud(true);}}>云对话</button>{!tasks.length&&<p>{loaded?'还没有任务':'正在读取…'}</p>}{[...grouped.values()].reverse().map(rows=>rows.at(-1)!).map(t=><button onContextMenu={e=>{e.preventDefault();setCloudId(t.conversationId??t.id);showCloud(true);}} key={t.id} aria-pressed={selected===t.id} onClick={()=>{setSelected(t.id);follow.current=true;setHistory(false);setSettings(false);}}><span>{t.prompt}</span><small>{states[t.state]??t.state}</small></button>)}</aside>}
   {settings?<div className="machine-chat-settings"><button onClick={()=>{setSettings(false);void loadModel();}}><ArrowLeft size={15}/>返回对话</button><AgentAssistantSettings call={call} connectAccount={connectAccount} onSaved={()=>void loadModel()}/></div>:<div className="machine-chat-conversation">
    {(error||refreshError)&&<ErrorNotice title="智能体暂时无法继续" error={error||refreshError} />}
    <div ref={feed} onScroll={e=>{const el=e.currentTarget;follow.current=el.scrollHeight-el.scrollTop-el.clientHeight<80;}} className="machine-chat-messages" aria-label="任务消息">
     {!task?<div className="machine-chat-empty"><Bot size={28}/><h2>{imported?'继续：'+imported.title:'想完成什么工作？'}</h2><p>在当前机器上处理任务，随时查看进度和执行记录。</p>{loaded&&tasks.length>0&&<button onClick={()=>setHistory(true)}>查看已有任务</button>}</div>:<>
      {turns.slice(0,turns.findIndex(r=>r.id===task.id)).map(row=><div key={row.id}><article className="machine-chat-user"><small>你</small><p>{row.prompt}</p></article><article className="machine-chat-answer"><small>智能体</small><Markdown remarkPlugins={[remarkGfm]}>{row.answer}</Markdown></article></div>)}
      <article className="machine-chat-user"><small>你</small><p>{task.prompt}</p></article>
      <article className="machine-chat-answer"><small><Bot size={15}/>智能体 · {states[task.state]??task.state}</small>{task.answer&&(mobile&&running(task)?<p style={{whiteSpace:'pre-wrap'}}>{task.answer}</p>:running(task)?<AiStreamingMarkdown key={task.id} text={task.answer} streaming={true} onReveal={()=>{}}/>:<Markdown remarkPlugins={[remarkGfm]}>{task.answer}</Markdown>)}{task.error&&<ErrorNotice title="智能体暂时无法继续" error={task.error} />}{!task.answer&&running(task)&&<p role="status">{states[task.state]}</p>}
      {mobile&&<button onClick={async()=>{try{setToolDetails(await call('assistant.task',{id:task.id}) as Task);}catch(e){setError(String(e));}}}>读取工具记录</button>}
      {mobile&&toolDetails?.id===task.id&&<details open><summary>工具记录 · {toolDetails.events?.length??0}</summary>{toolDetails.events?.map((ev,i)=><details key={i}><summary>{ev.tool}</summary><pre>{ev.output??'等待结果'}</pre></details>)}</details>}
      {!!task.events?.length&&<details><summary>工具记录 · {task.events.length}</summary>{task.events.map((event,i)=><details key={i}><summary>{event.tool}</summary><pre>{JSON.stringify(event.input,null,2)}</pre>{event.output&&<pre>{event.output}</pre>}</details>)}</details>}</article>
     </>}
    </div>
    <form className="machine-chat-compose" onSubmit={e=>{e.preventDefault();void submit();}}>
     <textarea aria-label="交给这台机器的任务" title={mobile?'输入消息':'Enter 发送，Shift+Enter 换行'} placeholder={selected?'补充要求，或继续这项任务…':'描述要在这台机器上完成的工作…'} value={prompt} onChange={e=>setDrafts(v=>({...v,[selected]:e.target.value}))} rows={3} onKeyDown={e=>{if(!mobile&&submitsComposer(e)){e.preventDefault();void submit();}}}/>
     <div>{model?.providers?.length?<select className="machine-chat-model" aria-label="智能体基座" value={model.providerId??''} disabled={busy||tasks.some(running)} onChange={async e=>{setBusy(true);setError('');try{setModel(await call('assistant.provider.select',{providerId:e.target.value}) as ModelSettings);}catch(error){setError(String(error));}finally{setBusy(false);}}}>
      {!model.providerId&&<option value="" disabled>{model.model||'选择基座'}</option>}
      {model.providers.map(provider=><option key={provider.id} value={provider.id}>{provider.name}{provider.official?' · 账号额度':''}</option>)}
     </select>:<button type="button" className="machine-chat-model" onClick={()=>setSettings(true)}>{model?.model||'选择基座'}</button>}
     <button type="button" className="machine-chat-policy" title="执行权限" onClick={()=>setSettings(true)}>{model?.review?'执行前审核':'已授权执行'}</button><span className="machine-chat-spacer"/>{running(task)?<button type="button" title="停止当前任务" aria-label="停止当前任务" disabled={stopping===task!.id} onClick={()=>void stop(task!.id)}><Square size={16}/>{stopping?'停止中':'停止'}</button>:<button title="发送任务（Enter 发送，Shift+Enter 换行）" aria-label="发送任务" className="primary" disabled={busy||!prompt.trim()||tasks.some(running)}><Send size={16}/>{busy?'提交中':'发送'}</button>}</div>
     {!running(task)&&tasks.some(running)&&<small>这台机器有任务正在执行，可在任务历史中查看或停止。</small>}
    </form>
   </div>}
  </div>
 </section>;
}
