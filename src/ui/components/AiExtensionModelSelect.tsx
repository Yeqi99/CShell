import {useEffect,useState} from 'react';
export function AiExtensionModelSelect({extension,onChange}:{extension:{id:string;model:string};onChange:(ref:string,model:string)=>void}){
 const [choices,setChoices]=useState<{ref:string;model:string;available:boolean}[]>([]),[error,setError]=useState('');
 useEffect(()=>{let active=true;void window.cshell.aiExtensionCall(extension.id,'choices',{reference:extension.model}).then(v=>{if(active)setChoices(v as typeof choices);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[extension.id,extension.model]);
 return <label>扩展模型<select value={extension.model} onChange={e=>{const c=choices.find(c=>c.ref===e.target.value);if(c)onChange(c.ref,c.model);}}><option value={extension.model}>{extension.model}</option>{choices.filter(c=>c.ref!==extension.model).map(c=><option key={c.ref} value={c.ref} disabled={!c.available}>{c.model}{c.available?'':' · 协议待适配'}</option>)}</select>{error&&<small role="alert">{error}</small>}</label>;
}
