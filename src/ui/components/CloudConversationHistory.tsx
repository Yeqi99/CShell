import {useEffect,useRef,useState} from 'react';
import {extendsChat,type ChatBridge,type ChatDocument,type ChatRecord,type ChatShelf} from '../../shared/cloud-conversations';

export function CloudConversationHistory({bridge,documents,shown,selected,onClose,onContinue}:{
  bridge:ChatBridge;documents:ChatDocument[];shown:boolean;selected?:string;onClose:()=>void;onContinue?:(doc:ChatDocument)=>Promise<void>;
}){
  const [shelf,setShelf]=useState<ChatShelf>(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[opened,open]=useState('');
  const latest=useRef(documents),locked=useRef(false);
  latest.current=documents;
  useEffect(()=>{
    let alive=true;
    const refresh=async()=>{
      if(locked.current||document.hidden)return;
      locked.current=true;
      try{
        let next=await bridge({action:'list'});
        for(const saved of next.records){
          if(!alive)break;
          const local=latest.current.find(d=>d.id===saved.id);
          if(local&&local.messages.length>saved.messages.length&&extendsChat(local,saved))
            next=await bridge({action:'save',account:next.account,revision:saved.revision,document:local});
        }
        if(alive){setShelf(next);setError('');}
      }catch(e){if(alive){setShelf(undefined);setError(String(e));}}
      finally{locked.current=false;}
    };
    void refresh();const timer=setInterval(()=>void refresh(),shown?15000:60000);
    return()=>{alive=false;clearInterval(timer);};
  },[bridge,shown]);
  if(!shown)return null;
  const local=documents.find(d=>d.id===selected),stored=shelf?.records.find(d=>d.id===selected);
  const write=async(remove:boolean)=>{
    if(!shelf||(!local&&!stored)||locked.current)return;
    locked.current=true;setBusy(true);
    try{setShelf(await bridge(remove?{action:'remove',account:shelf.account,id:stored!.id,revision:stored!.revision}:{action:'save',account:shelf.account,revision:stored?.revision??0,document:local!}));setError('');}
    catch(e){setError(String(e));}finally{locked.current=false;setBusy(false);}
  };
  const view=shelf?.records.find(d=>d.id===opened);
  return <section className="cloud-chat-history"><header><strong>云对话</strong> <button onClick={onClose}>关闭</button></header>
    {error&&<p role="alert">{error}</p>}
    {selected&&<p>{local?.title??stored?.title} {shelf&&(stored?<button disabled={busy} onClick={()=>void write(true)}>停止同步并移除云副本</button>:<button disabled={busy||!local} onClick={()=>void write(false)}>同步此对话到云端</button>)}</p>}
    {shelf&&!shelf.records.length&&<p>还没有同步的对话</p>}
    {shelf?.records.map((d:ChatRecord)=><button key={d.id} onClick={()=>open(d.id)}>{d.title} · {d.target}</button>)}
    {view&&<article>{view.messages.map((m,i)=><p key={i}><strong>{m.role==='user'?'你':'智能体'}</strong><br/>{m.text}</p>)}{onContinue&&<button onClick={()=>void onContinue({id:view.id,title:view.title,target:view.target,messages:view.messages}).catch(e=>setError(String(e)))}>在当前工作区继续</button>}</article>}
  </section>;
}
