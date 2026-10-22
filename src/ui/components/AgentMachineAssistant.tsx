import { ErrorNotice } from './ErrorNotice';
import {useEffect,useState} from 'react';
import {Bot,History,Plus,Settings,Send,Square,ArrowLeft,Server} from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {AgentCall} from '../../shared/agent';
import {AgentAssistantSettings} from './AgentAssistantSettings';
import {AiStreamingMarkdown} from './AiStreamingMarkdown';
import './machine-assistant.css';
type Task={id:string;prompt:string;answer:string;error?:string;state:string;createdAt?:string;events?:{tool:string;input:unknown;output?:string}[]};
const states:Record<string,string>={running:'正在执行',approval:'等待在目标机器的 cagent 中确认',queued:'等待执行',completed:'已完成',failed:'执行失败',cancelled:'已停止',interrupted:'已中断'};
const running=(task?:Task)=>!!task&&['running','approval','queued'].includes(task.state);
export function AgentMachineAssistant({call,name='当前机器'}:{name?:string;call:(method:AgentCall['method'],params?:unknown)=>Promise<unknown>}){
 const [drafts,setDrafts]=useState<Record<string,string>>({}),[selected,setSelected]=useState(''),[tasks,setTasks]=useState<Task[]>([]),[error,setError]=useState(''),[refreshError,setRefreshError]=useState(''),[busy,setBusy]=useState(false),[stopping,setStopping]=useState(''),[history,setHistory]=useState(false),[settings,setSettings]=useState(false),[model,setModel]=useState<{model:string;review:boolean;keyConfigured:boolean}>(),[loaded,setLoaded]=useState(false);
 const task=tasks.find(t=>t.id===selected),prompt=drafts[selected]??'';
 const loadModel=()=>call('assistant.settings').then(v=>setModel(v as typeof model)).catch(()=>setModel(undefined));
 useEffect(()=>{void loadModel();},[call]);
 useEffect(()=>{let alive=true,working=false,timer:ReturnType<typeof setTimeout>;const refresh=async()=>{try{const result=await call('assistant.tasks') as Task[];if(alive){working=result.some(running);setTasks(result);setRefreshError('');setLoaded(true);}}catch(e){working=false;if(alive)setRefreshError(String(e));}finally{if(alive)timer=setTimeout(()=>void refresh(),working?350:3000);}};void refresh();return()=>{alive=false;clearTimeout(timer)};},[call]);
 const submit=async()=>{if(busy||!prompt.trim()||tasks.some(running))return;const source=selected,text=prompt;setBusy(true);setError('');try{const result=await call('assistant.start',{...(source?{resumeId:source}:{}),requestId:crypto.randomUUID(),prompt:text.trim()}) as {id:string};setDrafts(v=>({...v,[source]:v[source]===text?'':v[source]}));setSelected(result.id);setTasks(await call('assistant.tasks') as Task[]);}catch(e){setError(String(e));}finally{setBusy(false);}};
 const stop=async(id:string)=>{setStopping(id);setError('');try{await call('assistant.cancel',{id});setTasks(await call('assistant.tasks') as Task[]);}catch(e){setError(String(e));}finally{setStopping('');}};
 return <section className="machine-chat" aria-label={name+'的智能体'}>
  <header className="machine-chat-header"><button title="任务历史" aria-label="任务历史" aria-expanded={history} onClick={()=>{setHistory(!history);setSettings(false);}}><History size={17}/></button><div><strong>智能体</strong><small><Server size={12}/>{name}</small></div><span className="machine-chat-spacer"/><button title="新任务" aria-label="新任务" onClick={()=>{setSelected('');setSettings(false);}}><Plus size={17}/></button><button title="模型与权限" aria-label="模型与权限" aria-expanded={settings} onClick={()=>{setSettings(!settings);setHistory(false);}}><Settings size={17}/></button></header>
  <div className="machine-chat-body">
   {history&&<aside className="machine-chat-history" aria-label="任务历史列表"><strong>任务历史</strong>{!tasks.length&&<p>{loaded?'还没有任务':'正在读取…'}</p>}{[...tasks].reverse().map(t=><button key={t.id} aria-pressed={selected===t.id} onClick={()=>{setSelected(t.id);setSettings(false);}}><span>{t.prompt}</span><small>{states[t.state]??t.state}</small></button>)}</aside>}
   {settings?<div className="machine-chat-settings"><button onClick={()=>{setSettings(false);void loadModel();}}><ArrowLeft size={15}/>返回对话</button><AgentAssistantSettings call={call} onSaved={()=>void loadModel()}/></div>:<div className="machine-chat-conversation">
    {(error||refreshError)&&<ErrorNotice title="智能体暂时无法继续" error={error||refreshError} />}
    <div className="machine-chat-messages" aria-label="任务消息">
     {!task?<div className="machine-chat-empty"><Bot size={38}/><h2>在 {name} 上开始任务</h2><p>描述你要完成的工作，执行记录和结果会显示在这里。</p>{loaded&&tasks.length>0&&<button onClick={()=>setHistory(true)}>查看已有任务</button>}</div>:<>
      <article className="machine-chat-user"><small>你</small><p>{task.prompt}</p></article>
      <article className="machine-chat-answer"><small><Bot size={15}/>智能体 · {states[task.state]??task.state}</small>{task.answer&&(running(task)?<AiStreamingMarkdown key={task.id} text={task.answer} streaming={true} onReveal={()=>{}}/>:<Markdown remarkPlugins={[remarkGfm]}>{task.answer}</Markdown>)}{task.error&&<ErrorNotice title="智能体暂时无法继续" error={task.error} />}{!task.answer&&running(task)&&<p role="status">{states[task.state]}</p>}
      {!!task.events?.length&&<details><summary>工具记录 · {task.events.length}</summary>{task.events.map((event,i)=><details key={i}><summary>{event.tool}</summary><pre>{JSON.stringify(event.input,null,2)}</pre>{event.output&&<pre>{event.output}</pre>}</details>)}</details>}</article>
     </>}
    </div>
    <form className="machine-chat-compose" onSubmit={e=>{e.preventDefault();void submit();}}>
     <textarea aria-label="交给这台机器的任务" placeholder={selected?'补充要求，或继续这项任务…':'描述要在这台机器上完成的工作…'} value={prompt} onChange={e=>setDrafts(v=>({...v,[selected]:e.target.value}))} rows={3} onKeyDown={e=>{if(e.key==='Enter'&&e.ctrlKey&&!e.nativeEvent.isComposing){e.preventDefault();void submit();}}}/>
     <div><button type="button" className="machine-chat-model" title="配置这台机器的模型与权限" onClick={()=>setSettings(true)}>{model?.model||'配置模型'}<span>· {model?model.review?'执行前审核':'按已授权范围执行':'读取配置'}</span></button><span className="machine-chat-spacer"/>{running(task)?<button type="button" title="停止当前任务" aria-label="停止当前任务" disabled={stopping===task!.id} onClick={()=>void stop(task!.id)}><Square size={16}/>{stopping?'停止中':'停止'}</button>:<button title="发送任务（Ctrl+Enter）" aria-label="发送任务" className="primary" disabled={busy||!prompt.trim()||tasks.some(running)}><Send size={16}/>{busy?'提交中':'发送'}</button>}</div>
     {!running(task)&&tasks.some(running)&&<small>这台机器有任务正在执行，可在任务历史中查看或停止。</small>}
    </form>
   </div>}
  </div>
 </section>;
}
