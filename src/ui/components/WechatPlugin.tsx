import { usePermissionFocus } from '../permission-navigation';
import { useEffect,useState } from 'react';
import { emptyWechatConfig,parseWechatConfig,type WechatConfig } from '../../shared/wechat';
export function WechatPlugin({api=window.cshell,remote=false}:{api?:Pick<typeof window.cshell,'wechatStatus'|'wechatSave'|'wechatStopSubscriptions'>;remote?:boolean}={}){
  const [draft,setDraft]=useState<WechatConfig>(emptyWechatConfig);
  const [processes,setProcesses]=useState<{pid:number;version:string}[]>([]);
  const [send,setSend]=useState(''),[sendBlocked,setSendBlocked]=useState(''),[receive,setReceive]=useState(''),[history,setHistory]=useState(''),[remarks,setRemarks]=useState('');
  const [subscriptions,setSubscriptions]=useState<{id:string;state:string;reason?:string}[]>([]);
  const [message,setMessage]=useState(''),[busy,setBusy]=useState(true);
  usePermissionFocus('wechat',!busy);
  async function refresh(initial=false){setBusy(true);try{const s=await api.wechatStatus();setProcesses(s.processes);setSubscriptions(s.subscriptions??[]);setMessage(s.error??'');if(initial){setDraft(s.config);setSend(s.config.send.join('\n'));setSendBlocked(s.config.sendBlocked.join('\n'));setReceive(s.config.receive.join('\n'));setHistory(s.config.history.join('\n'));setRemarks(s.config.remarks.join('\n'));}}catch(e){setMessage(String(e));}finally{setBusy(false);}}
  useEffect(()=>{void refresh(true);},[]);
  const ids=(text:string)=>[...new Set(text.split(/[\s,，]+/).filter(Boolean))];
  async function save(){setBusy(true);try{await api.wechatSave(parseWechatConfig({...draft,send:ids(send),sendBlocked:ids(sendBlocked),receive:ids(receive),history:ids(history),remarks:ids(remarks)}));setMessage('已保存。请在智能体访问权限中勾选微信读取、发送或修改备注，再开始测试。');}catch(e){setMessage(String(e));}finally{setBusy(false);}}
  return <section className="wechat-plugin" style={{maxWidth:720,padding:20,display:'grid',gap:14}}>
    <p>{remote?'控制当前连接的 CAgent 机器上的微信，不访问控制端微信。':'仅控制此电脑当前登录的微信，与智能体绑定的远端机器无关。'}实验适配可能导致微信崩溃；历史读取目前覆盖本地 message_0.db；其他分片和已删除消息不保证可用。</p>
    <div><span>消息订阅：{subscriptions.filter(s=>s.state==='listening').length} 个运行中</span> <button disabled={busy} onClick={()=>void api.wechatStopSubscriptions().then(()=>refresh()).catch(e=>setMessage(String(e)))}>停止监听</button></div>
    <small>可在智能体中请求持续监听。默认持续 1 小时，最多 24 小时；退出托管程序或撤销接收权限后停止。订阅不会自动回复消息。</small>
    <fieldset disabled={busy} style={{display:'contents'}}>
    <label data-permission-node="wechat/pid">微信进程 <select aria-label="微信进程" value={draft.pid??''} onChange={e=>setDraft({...draft,pid:e.target.value?Number(e.target.value):null})} disabled={busy}><option value="">请选择</option>{processes.map(p=><option key={p.pid} value={p.pid}>微信 {p.version} · PID {p.pid}</option>)}</select></label>
    <button disabled={busy} onClick={()=>void refresh()}>刷新进程</button>
    <label data-permission-node="wechat/experimental" style={{display:"flex",flexDirection:"row",alignItems:"center",gap:8}}><input type="checkbox" checked={draft.experimental} onChange={e=>setDraft({...draft,experimental:e.target.checked})}/>我了解崩溃风险，允许本机实验控制</label>
    <label data-permission-node="wechat/enabled" style={{display:"flex",flexDirection:"row",alignItems:"center",gap:8}}><input type="checkbox" checked={draft.enabled} onChange={e=>setDraft({...draft,enabled:e.target.checked})}/>启用微信控制</label>
    <label data-permission-node="wechat/readContacts" style={{display:"flex",flexDirection:"row",alignItems:"center",gap:8}}><input type="checkbox" checked={draft.readContacts} onChange={e=>setDraft({...draft,readContacts:e.target.checked})}/>允许分页读取通讯录记录（含群及非好友记录）</label>
    <label data-permission-node="wechat/readMoments" style={{display:"flex",flexDirection:"row",alignItems:"center",gap:8}}><input type="checkbox" checked={draft.readMoments} onChange={e=>setDraft({...draft,readMoments:e.target.checked})}/>允许读取朋友圈本地缓存（记录增量变化，不刷新或发布）</label>
    <label data-permission-node="wechat/publishMoments" style={{display:"flex",flexDirection:"row",alignItems:"center",gap:8}}><input type="checkbox" checked={draft.publishMoments} onChange={e=>setDraft({...draft,publishMoments:e.target.checked})}/>允许发布纯文字朋友圈（非私密，独立于聊天发送授权）</label>
    <label data-permission-node="wechat/readSessions" style={{display:"flex",flexDirection:"row",alignItems:"center",gap:8}}><input type="checkbox" checked={draft.readSessions} onChange={e=>setDraft({...draft,readSessions:e.target.checked})}/>允许读取最近会话（会话 ID、未读数与时间，不含消息正文）</label>
    <label data-permission-node="wechat/send">允许发送到（填 * 允许所有人；留空禁止发送）<textarea style={{width:"100%",minHeight:58,padding:8,border:"1px solid var(--border)",borderRadius:6,background:"var(--panel)",color:"var(--text)",fontFamily:"inherit",fontSize:12,resize:"vertical"}} aria-label="微信发送授权" rows={2} value={send} onChange={e=>setSend(e.target.value)}/></label>
    <label data-permission-node="wechat/sendBlocked">发送黑名单（每行一个内部 ID，优先拦截）<textarea style={{width:"100%",minHeight:58,padding:8,border:"1px solid var(--border)",borderRadius:6,background:"var(--panel)",color:"var(--text)",fontFamily:"inherit",fontSize:12,resize:"vertical"}} aria-label="微信发送黑名单" rows={2} value={sendBlocked} onChange={e=>setSendBlocked(e.target.value)}/></label>
    <label data-permission-node="wechat/receive">允许接收（内部 ID 或 *）<textarea style={{width:"100%",minHeight:58,padding:8,border:"1px solid var(--border)",borderRadius:6,background:"var(--panel)",color:"var(--text)",fontFamily:"inherit",fontSize:12,resize:"vertical"}} aria-label="微信接收授权" rows={2} value={receive} onChange={e=>setReceive(e.target.value)}/></label>
    <label data-permission-node="wechat/history">允许读取历史（内部 ID 或 *）<textarea style={{width:"100%",minHeight:58,padding:8,border:"1px solid var(--border)",borderRadius:6,background:"var(--panel)",color:"var(--text)",fontFamily:"inherit",fontSize:12,resize:"vertical"}} aria-label="微信历史授权" rows={2} value={history} onChange={e=>setHistory(e.target.value)}/></label>
    <label data-permission-node="wechat/remarks">允许修改备注（好友内部 ID 或 *）<textarea style={{width:"100%",minHeight:58,padding:8,border:"1px solid var(--border)",borderRadius:6,background:"var(--panel)",color:"var(--text)",fontFamily:"inherit",fontSize:12,resize:"vertical"}} aria-label="微信备注授权" rows={2} value={remarks} onChange={e=>setRemarks(e.target.value)}/></label>
    <small>各授权字段填 * 表示允许所有账号，留空表示不授权；黑名单只填准确 ID。实际操作仍需指定目标，不会自动读取所有会话或批量修改备注。支持 wxid_…、数字@chatroom 和 filehelper（文件传输助手）。不使用昵称猜测收件人。微信重启后需重新绑定；切换账号后请重新核对授权。</small>
    <div><button className="primary" disabled={busy} onClick={()=>void save()}>保存</button></div>
    </fieldset>
    <p role="status">{message}</p>
  </section>;
}
