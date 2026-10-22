import { ErrorNotice } from './ErrorNotice';
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { AiConversation } from './AiConversation';
import { TextAssist } from './TextAssist';
import { type AiSnapshot, type AiThread, emptyAiPolicy } from '../../shared/ai';
import type { AnalysisRequest } from '../text-assist';
import './ai-panel.css';

/** One context assistant per view window; selections remain drafts until the user sends. */
export function MonitorAiAssist() {
  const [visible,setVisible]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [snapshot,setSnapshot]=useState<AiSnapshot>({providers:[],threads:[],permissions:[],policy:emptyAiPolicy(),extractionProviderId:null});
  const [id,setId]=useState(''),[insertion,setInsertion]=useState<{id:string;text:string;threadId:string}|null>(null);
  const queue=useRef(Promise.resolve()), selected=useRef('');
  const sessions=useRef(new Map<string,string>());
  const refresh=async()=>{const next=await window.cshell.aiSnapshot();setSnapshot(next);return next;};
  useEffect(()=>{
    const analyze=(event:Event)=>{const request=(event as CustomEvent<AnalysisRequest>).detail;if(request?.recipient!=='monitor')return;
      setVisible(true);setError('');setBusy(true);
      queue.current=queue.current.catch(()=>{}).then(async()=>{
        if(!request.sessionId)throw Error('请从已连接的视图终端选择文字后分析，以便绑定正确机器');
        const next=await refresh();let thread=next.threads.find(t=>t.id===sessions.current.get(request.sessionId!)&&t.sessionId===request.sessionId);
        if(!thread){const provider=next.providers[0];if(!provider)throw Error('请先在主窗口配置模型基座');thread=await window.cshell.aiThreadCreate('terminal',provider.id,'review',request.sessionId);}
        sessions.current.set(request.sessionId,thread.id);selected.current=thread.id;setId(thread.id);await refresh();setInsertion({id:crypto.randomUUID(),text:request.text,threadId:thread.id});
      }).catch(e=>setError(String(e))).finally(()=>setBusy(false));
    };
    window.addEventListener('cshell:analyze-selection',analyze);
    return()=>window.removeEventListener('cshell:analyze-selection',analyze);
  },[]);
  useEffect(()=>{if(!visible)return;let alive=true;const timer=setInterval(()=>{void window.cshell.aiSnapshot().then(next=>{if(alive)setSnapshot(next);}).catch(e=>{if(alive)setError(String(e));});},1000);return()=>{alive=false;clearInterval(timer);};},[visible]);
  useEffect(()=>window.cshell.onAiThread(thread=>setSnapshot(old=>({...old,threads:[...old.threads.filter(t=>t.id!==thread.id),thread]}))),[]);
  const thread=snapshot.threads.find(t=>t.id===id);
  const run=async(fn:()=>Promise<unknown>)=>{setBusy(true);setError('');try{await fn();await refresh();}catch(e){setError(String(e));}finally{setBusy(false);}};
  return <><TextAssist/><aside className="ai-panel monitor-context-assistant" hidden={!visible} aria-label="视图终端智能体" style={{position:'fixed',right:8,top:44,bottom:8,height:'auto',width:'min(480px, calc(100vw - 16px))',zIndex:40,boxShadow:'0 8px 32px #0002',borderRadius:10,background:'var(--panel)'}}>
    <header><strong>终端 AI 分析</strong><button aria-label="收起分析" title="收起分析（保留会话）" onClick={()=>setVisible(false)}><X size={16}/></button></header>
    {error&&<ErrorNotice title="智能体操作未完成" error={error} />}
    {busy&&!thread&&<p role="status">正在准备绑定此终端的会话…</p>}
    <div className="agent-chat-page">{thread&&<AiConversation snapshot={snapshot} thread={thread} insertion={insertion} location="terminal" providerId={thread.providerId} mode={thread.mode} sessionId={thread.sessionId} busy={busy} executionVisible={true}
      openThread={next=>{if(snapshot.threads.some(t=>t.id===next)){selected.current=next;setId(next);}else setError('该会话不属于当前视图');}}
      setProviderId={()=>{}} setMode={mode=>{void run(()=>window.cshell.aiMode(thread.id,mode));}}
      create={async():Promise<AiThread>=>thread} run={run} configure={()=>setError('模型与权限请在 CShell 主窗口设置')}/>}</div>
  </aside></>;
}
