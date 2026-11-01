import {useEffect,useRef,useState} from 'react';
import {Activity,CheckCircle2,Info} from 'lucide-react';
export function ConnectionProbe({host,port,disabled=false}:{host:string;port:number;disabled?:boolean}){
 const [busy,setBusy]=useState(false),[result,setResult]=useState<{ok:boolean;text:string}>();const revision=useRef(0);
 useEffect(()=>{revision.current++;setResult(undefined);setBusy(false);return()=>{revision.current++}},[host,port]);
 const valid=!!host.trim()&&!/[\s/\\@\0-\x1f]/.test(host.trim())&&Number.isInteger(port)&&port>0&&port<=65535;
 return <div className="connection-probe"><button type="button" disabled={disabled||busy||!valid||!window.cshell.connectionProbe} onClick={async()=>{const current=++revision.current;setBusy(true);setResult(undefined);try{const r=await window.cshell.connectionProbe!({host:host.trim(),port});if(current===revision.current)setResult({ok:r.failed===0,text:r.failed?'端口未响应，请检查地址、端口与防火墙':`端口可达 · ${Math.round(r.averageMs??0)} ms`});}catch(e){if(current===revision.current)setResult({ok:false,text:String(e).replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'')});}finally{if(current===revision.current)setBusy(false)}}}><Activity size={14}/>{busy?'检测中…':'检测连通性'}</button>{result&&<span role="status" className={result.ok?'ok':'notice'}>{result.ok?<CheckCircle2 size={14}/>:<Info size={14}/>}<span>{result.text}<small>仅检测本机到此端口，不保存连接或验证账号。</small></span></span>}</div>
}
