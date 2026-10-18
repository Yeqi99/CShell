import { useState } from 'react';
import type { Profile } from '../../shared/contracts';
import { ConnectionExtractor } from './ConnectionExtractor';
import { useI18n } from '../i18n';

export function RdpConnectionForm({profile,saved=false,onSaved}:{profile?:Profile;saved?:boolean;onSaved:()=>Promise<void>}){
 const {locale}=useI18n(),cn=locale==='zh-CN';
 const [draft,setDraft]=useState<Profile>(()=>profile??{id:crypto.randomUUID(),protocol:'rdp',host:'',port:3389,username:'',name:'',group:'',favorite:false,auth:'password'});
 const [port,setPort]=useState(String(draft.port)),[password,setPassword]=useState(''),[clear,setClear]=useState(false),[hasPassword,setHasPassword]=useState(saved);
 const [busy,setBusy]=useState(false),[extracting,setExtracting]=useState(false),[message,setMessage]=useState('');
 const submit=async(open:boolean)=>{
  setBusy(true);setMessage('');
  try{
   const next={...draft,host:draft.host.trim(),port:Number(port),username:draft.username.trim(),name:draft.name.trim()||draft.host.trim()};
   await window.cshell.saveRdp(next,password||undefined,clear);setDraft(next);setHasPassword((await window.cshell.config()).savedCredentials.includes(next.id));setPassword('');setClear(false);await onSaved();
   if(open)await window.cshell.openRdp(next.id);
   setMessage(open?(cn?'已保存并打开远程桌面客户端。':'Saved and opened Remote Desktop.'):(cn?'已保存到左侧连接列表。':'Saved to the connection list.'));
  }catch(e){setMessage((e as Error).message);}finally{setBusy(false);}
 };
 return <section className="editor-page connection-editor compact-connection">
  <ConnectionExtractor title={cn?'Windows 远程桌面':'Windows Remote Desktop'} titleId={draft.id+'-title'} providerId="cshell.rdp" disabled={busy} onBusy={setExtracting} onStart={()=>setMessage('')} onExtract={({fields})=>{
   const {password:pw,port:p,url:_,auth:__,...rest}=fields;setDraft(d=>({...d,...rest}));if(p!==undefined)setPort(String(p));if(pw!==undefined)setPassword(pw);
  }}/>
  <form className="rdp-connect-form" onSubmit={e=>{e.preventDefault();void submit(false);}}>
   <fieldset disabled={busy||extracting}>
    <label>{cn?'主机地址':'Host'}<input required value={draft.host} onChange={e=>setDraft({...draft,host:e.target.value})}/></label>
    <label>{cn?'端口':'Port'}<input type="number" required min={1} max={65535} value={port} onChange={e=>setPort(e.target.value)}/></label>
    <label>{cn?'账号':'Username'}<input required autoComplete="username" value={draft.username} onChange={e=>setDraft({...draft,username:e.target.value})}/></label>
    <label>{cn?'密码':'Password'}<input type="password" autoComplete="new-password" value={password} disabled={clear} placeholder={hasPassword?(cn?'已保存；留空保留':'Saved; leave empty to retain'):''} onChange={e=>setPassword(e.target.value)}/></label>
    {hasPassword&&<label><input type="checkbox" checked={clear} onChange={e=>setClear(e.target.checked)}/>{cn?'清除已保存密码':'Clear saved password'}</label>}
    <details><summary>{cn?'名称与分组':'Name and group'}</summary>
     <label>{cn?'名称':'Name'}<input value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
     <label>{cn?'分组':'Group'}<input value={draft.group} onChange={e=>setDraft({...draft,group:e.target.value})}/></label>
     <label><input type="checkbox" checked={draft.favorite} onChange={e=>setDraft({...draft,favorite:e.target.checked})}/>{cn?'收藏':'Favorite'}</label>
    </details>
   </fieldset>
   <p>{cn?'密码加密保存。双击列表中的连接即可启动；系统策略或首次服务器身份核验仍可能要求确认。':'Passwords are encrypted. Double-click a saved connection to launch; Windows policy or server identity checks may still prompt.'}</p>
   <div className="connection-actions"><button type="submit" className="primary" disabled={busy||extracting}>{cn?'保存':'Save'}</button><button type="button" disabled={busy||extracting} onClick={e=>{if(e.currentTarget.form?.reportValidity())void submit(true);}}>{cn?'保存并连接':'Save and connect'}</button></div>
   {message&&<p role="status">{message}</p>}
  </form>
 </section>;
}
