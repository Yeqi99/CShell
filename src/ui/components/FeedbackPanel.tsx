import {useId,useState} from 'react';
import {version} from '../../../package.json';
import {feedbackDiagnostic,redactFeedback} from '../../shared/feedback';
import './feedback-panel.css';
export function FeedbackPanel({error='',english=false}:{error?:string;english?:boolean}){
 const fieldId=useId();
 const [message,setMessage]=useState(''),[contact,setContact]=useState(''),[include,setInclude]=useState(false),[busy,setBusy]=useState(false),[status,setStatus]=useState(''),[id,setId]=useState(()=>crypto.randomUUID());
 const diagnostic=feedbackDiagnostic(error),cleanMessage=redactFeedback(message.trim()),cleanContact=redactFeedback(contact.trim()),t=(zh:string,en:string)=>english?en:zh;
 function changed(){setId(crypto.randomUUID());setStatus('');}
 async function send(){
  if(busy||!cleanMessage)return;setBusy(true);setStatus('');
  try{
   if(!window.cshell.submitFeedback)throw Error('Unsupported');
   await window.cshell.submitFeedback({id,message:cleanMessage,contact:cleanContact||undefined,version,platform:window.cshell.platform,diagnostic:include?diagnostic:undefined});
   setStatus(t('反馈已送达，编号：','Feedback sent. ID: ')+id);setMessage('');setInclude(false);setId(crypto.randomUUID());
  }catch{setStatus(t('反馈暂未送达，内容已保留，请稍后重试。','Feedback was not delivered. Your draft is retained; please retry.'));}
  finally{setBusy(false);}
 }
 return <details className="feedback-panel"><summary>{t('反馈问题或建议','Send feedback')}</summary><div className="feedback-fields">
  <div className="feedback-field"><label htmlFor={fieldId+'-message'}>{t('问题描述','Description')}</label><textarea id={fieldId+'-message'} disabled={busy} maxLength={6000} rows={4} value={message} onChange={e=>{setMessage(e.target.value);changed();}} placeholder={t('你做了什么、期望什么、实际发生了什么。请勿填写密码或密钥。','Steps, expected behavior and actual result. Do not include passwords or keys.')}/></div>
  <label>{t('联系方式（选填）','Contact (optional)')}<input disabled={busy} maxLength={254} value={contact} onChange={e=>{setContact(e.target.value);changed();}}/></label>
  <div className="feedback-preview"><strong>{t('提交内容预览','Submission preview')}</strong><p>{version} · {window.cshell.platform} · {id}</p>
   <pre>{cleanMessage||t('尚未填写描述','No description yet')}</pre>{cleanContact&&<p>{cleanContact}</p>}
   <p>{t('不读取连接、日志或截图。常见密钥格式会脱敏，请检查预览后提交。','Connections, logs and screenshots are not collected. Known secret formats are redacted; review before sending.')}</p>
   {diagnostic&&<><label><input disabled={busy} type="checkbox" checked={include} onChange={e=>{setInclude(e.target.checked);changed();}}/>{t('附带以下错误代码','Include these error codes')}</label><pre>{diagnostic}</pre></>}
  </div>
  <div><button type="button" disabled={busy||!cleanMessage||!window.cshell.submitFeedback} onClick={()=>void send()}>{busy?t('正在提交…','Sending…'):t('提交反馈','Send feedback')}</button></div>
  {!window.cshell.submitFeedback&&<p>{t('此平台尚未支持提交反馈。','Feedback is not supported on this platform yet.')}</p>}{status&&<p role="status">{status}</p>}
 </div></details>;
}
