import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CloudConversationHistory } from '../../src/ui/components/CloudConversationHistory';
import type { ChatBridge, ChatDocument } from '../../src/shared/cloud-conversations';

type Api = (action:string, input?:Record<string,unknown>)=>Promise<any>;
type Model = {id:string;name?:string};
function PhoneChat({api,cloud,close,stop}:{api:Api;cloud:ChatBridge;close:()=>void;stop:()=>void}){
  const [docs,setDocs]=useState<ChatDocument[]>([]),[current,select]=useState(''),[account,setAccount]=useState('');
  const [models,setModels]=useState<Model[]>([]),[model,setModel]=useState('');
  const [draft,setDraft]=useState(''),[partial,setPartial]=useState(''),[sending,setSending]=useState(''),[error,setError]=useState('');
  const [history,setHistory]=useState(false),[cloudOpen,setCloud]=useState(false),[cloudId,setCloudId]=useState('');
  const pane=useRef<HTMLDivElement>(null),follow=useRef(true),alive=useRef(true);
  useEffect(()=>{alive.current=true;let cancelled=false;
    void api('phone-history').then(v=>{if(cancelled)return;setAccount(v.account);setDocs(v.documents);const rows:Model[]=v.models.map((m:string|Model)=>typeof m==='string'?{id:m}:m);setModels(rows);setModel(rows[0]?.id??'');select(v.documents.at(-1)?.id??'');}).catch(e=>{if(!cancelled)setError(String(e));});
    const delta=(e:Event)=>{setPartial((e as CustomEvent<string>).detail);};window.addEventListener('phone-chat-delta',delta);
    return()=>{cancelled=true;alive.current=false;window.removeEventListener('phone-chat-delta',delta);};
  },[api]);
  useEffect(()=>{if(follow.current&&pane.current)pane.current.scrollTop=pane.current.scrollHeight;},[docs,current,partial,sending]);
  const doc=docs.find(d=>d.id===current);
  async function send(){
    const text=draft.trim();if(!text||sending||!model)return;
    const outgoing:ChatDocument={id:doc?.id??crypto.randomUUID(),title:doc?.title??text.slice(0,80),target:'手机智能体',messages:[...(doc?.messages??[]),{role:'user',text}]};
    setSending(text);setPartial('');setError('');follow.current=true;
    try{const reply:ChatDocument=await api('phone-chat',{account,model,document:outgoing});if(!alive.current)return;
      setDocs(prev=>[...prev.filter(d=>d.id!==reply.id),reply]);select(reply.id);setDraft('');
      try{const shelf=await cloud({action:'list'}),saved=shelf.records.find(d=>d.id===reply.id);
        if(saved&&shelf.account===account&&saved.messages.length===outgoing.messages.length-1&&saved.messages.every((m,i)=>m.role===outgoing.messages[i].role&&m.text===outgoing.messages[i].text))
          await cloud({action:'save',account,revision:saved.revision,document:reply});
      }catch(e){setError('云同步稍后重试 · '+String(e));}
    }catch(e){if(alive.current)setError(String(e));}finally{if(alive.current){setSending('');setPartial('');}}
  }
  return <section className="phone-chat"><header><button onClick={close}>返回</button><strong>智能体</strong><button disabled={!!sending} onClick={()=>setHistory(!history)}>历史</button><button disabled={!!sending} onClick={()=>{select('');setDraft('');setHistory(false);}}>新对话</button></header>
    {error&&<p role="alert">{error}</p>}
    {account&&<CloudConversationHistory bridge={cloud} documents={docs} selected={cloudId} shown={cloudOpen} onClose={()=>setCloud(false)} onContinue={async d=>{setDocs(prev=>[...prev.filter(x=>x.id!==d.id),{id:d.id,title:d.title,target:d.target,messages:d.messages}]);select(d.id);setDraft('');setCloud(false);setHistory(false);}}/>}
    {history?<div className="phone-chat-feed"><button onClick={()=>{setCloudId('');setCloud(true);}}>云对话</button>{[...docs].reverse().map(d=><div key={d.id} onContextMenu={e=>{e.preventDefault();setCloudId(d.id);setCloud(true);}}><button onClick={()=>{select(d.id);setHistory(false);setDraft('');}}>{d.title}</button><button aria-label={'同步 '+d.title} onClick={()=>{setCloudId(d.id);setCloud(true);}}>同步设置</button></div>)}</div>:<>
    <div className="phone-chat-feed" ref={pane} onScroll={e=>{const el=e.currentTarget;follow.current=el.scrollHeight-el.scrollTop-el.clientHeight<80;}}>{doc?.messages.map((m,i)=><article key={i}><small>{m.role==='user'?'你':'智能体'}</small><p>{m.text}</p></article>)}{sending&&<><article><small>你</small><p>{sending}</p></article><article><small>智能体</small><p>{partial||'正在等待模型…'}</p></article></>}</div>
    <form onSubmit={e=>{e.preventDefault();void send();}}><textarea aria-label="消息" placeholder="输入消息" value={draft} disabled={!!sending} onChange={e=>setDraft(e.target.value)}/><footer><select aria-label="模型" value={model} disabled={!!sending} onChange={e=>setModel(e.target.value)}>{models.map(m=><option key={m.id} value={m.id}>{m.name??m.id}</option>)}</select>{sending?<button type="button" onClick={stop}>停止</button>:<button disabled={!draft.trim()||!model}>发送</button>}</footer></form></>}
  </section>;
}
export function openPhoneChat(api:Api,cloud:ChatBridge,stop:()=>void){
  const node=document.createElement('div');document.body.append(node);const root=createRoot(node);
  const close=()=>{stop();root.unmount();node.remove();window.removeEventListener('phone-chat-close',close);};
  window.addEventListener('phone-chat-close',close);root.render(<PhoneChat api={api} cloud={cloud} stop={stop} close={close}/>);
}
