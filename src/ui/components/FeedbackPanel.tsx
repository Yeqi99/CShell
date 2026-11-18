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
 const [report,setReport]=useState<{id:string;message:string}|null>(null);
 const [sent,setSent]=useState(false);
 const [reportStatus,setReportStatus]=useState('');
 async function reportFailure(){
  if(busy||sent||!window.cshell.submitFeedback)return;
  setBusy(true);
  try{
   let payload=report;
   if(!payload){
    const category=/timeout|超时/i.test(error)?'请求超时':/denied|权限/i.test(error)?'权限错误':/connect|连接/i.test(error)?'连接失败':'操作失败';
    const context=[category,diagnostic].filter(Boolean).join(' · ');
    let summary=context;
    setReportStatus(t('AI 正在总结…','Summarizing…'));
    try{
     const result=await window.cshell.aiText({kind:'compose',text:'用一句话反馈错误类别与错误代码，仅描述已知现象。',context});
     summary=redactFeedback(result.choices[0]?.trim()||context);
    }catch{/* Preserve classified diagnostics if the model is unavailable. */}
    payload={id:crypto.randomUUID(),message:summary};
    setReport(payload);
   }
   setReportStatus(t('正在提交…','Sending…'));
   await window.cshell.submitFeedback({...payload,version,platform:window.cshell.platform,diagnostic:diagnostic||undefined});
   setSent(true);
   setReportStatus(t('反馈已送达，编号：','Feedback sent. ID: ')+payload.id);
  }catch{setReportStatus(t('反馈暂未送达，可点击重试。','Delivery failed. Select the button to retry.'));}
  finally{setBusy(false);}
 }
 return <>{error&&window.cshell.submitFeedback&&<div className="feedback-panel"><button disabled={busy||sent} type="button" onClick={()=>void reportFailure()}>{t('AI 总结并反馈','Summarize and report')}</button>{reportStatus&&<p role="status">{reportStatus}</p>}</div>}<details className="feedback-panel"><summary>{t('反馈问题或建议','Send feedback')}</summary><div className="feedback-fields">
  <div className="feedback-field"><label htmlFor={fieldId+'-message'}>{t('问题描述','Description')}</label><textarea id={fieldId+'-message'} disabled={busy} maxLength={6000} rows={4} value={message} onChange={e=>{setMessage(e.target.value);changed();}} placeholder={t('你做了什么、期望什么、实际发生了什么。请勿填写密码或密钥。','Steps, expected behavior and actual result. Do not include passwords or keys.')}/></div>
  <label>{t('联系方式（选填）','Contact (optional)')}<input disabled={busy} maxLength={254} value={contact} onChange={e=>{setContact(e.target.value);changed();}}/></label>
  <div className="feedback-preview"><strong>{t('提交内容预览','Submission preview')}</strong><p>{version} · {window.cshell.platform} · {id}</p>
   <pre>{cleanMessage||t('尚未填写描述','No description yet')}</pre>{cleanContact&&<p>{cleanContact}</p>}
   <p>{t('不读取连接、日志或截图。常见密钥格式会脱敏，请检查预览后提交。','Connections, logs and screenshots are not collected. Known secret formats are redacted; review before sending.')}</p>
   {diagnostic&&<><label><input disabled={busy} type="checkbox" checked={include} onChange={e=>{setInclude(e.target.checked);changed();}}/>{t('附带以下错误代码','Include these error codes')}</label><pre>{diagnostic}</pre></>}
  </div>
  <div><button type="button" disabled={busy||!cleanMessage||!window.cshell.submitFeedback} onClick={()=>void send()}>{busy?t('正在提交…','Sending…'):t('提交反馈','Send feedback')}</button></div>
  {!window.cshell.submitFeedback&&<p>{t('此平台尚未支持提交反馈。','Feedback is not supported on this platform yet.')}</p>}{status&&<p role="status">{status}</p>}
 </div></details></>;
}
