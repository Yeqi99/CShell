import {useState} from 'react';
import {ErrorNotice} from './ErrorNotice';
import {useI18n} from '../i18n';
import './cloud-mcp-clients.css';
type Listing=Awaited<ReturnType<typeof window.cshell.cloudMcpClients>>;
export function CloudMcpClients(){
 const {locale}=useI18n(),zh=locale==='zh-CN';
 const [data,setData]=useState<Listing>({}),[name,setName]=useState(''),[bridge,setBridge]=useState(''),[token,setToken]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[revoke,setRevoke]=useState(''),[copied,setCopied]=useState(false);
 const run=async(action:()=>Promise<void>)=>{setBusy(true);setError('');try{await action();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 const refresh=async()=>{const next=await window.cshell.cloudMcpClients();setData(next);setBridge(current=>current||next.bridges?.[0]?.id||'');};
 return <details className="cloud-mcp-clients" onToggle={e=>{if(e.currentTarget.open&&!data.clients)void run(refresh);}}><summary>{zh?'会员远程 MCP 客户端':'Member remote MCP clients'}</summary>
 <p className="muted">{zh?'使用独立令牌连接云端；操作范围沿用所选机器的 MCP 客户端授权。撤销后现有长连接也会关闭。':'Connect with a separate token. The selected desktop’s MCP grants still apply. Revocation also closes existing sessions.'}</p>
 {error&&<ErrorNotice error={error} title={zh?'客户端操作未完成':'Client operation incomplete'}/>}
 {!data.endpoint&&<p className="muted">{zh?'服务入口尚未配置，暂不可创建连接。':'The service endpoint is not configured yet.'}</p>}
 {data.endpoint&&<><p><code>{data.endpoint}</code></p><div className="settings-row"><label>{zh?'连接名称':'Client name'}<input maxLength={80} value={name} onChange={e=>setName(e.target.value)}/></label><label>{zh?'执行机器':'Desktop'}<select value={bridge} onChange={e=>setBridge(e.target.value)}><option value="">—</option>{data.bridges?.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label><button type="button" disabled={busy||!name.trim()||!bridge} onClick={()=>void run(async()=>{const result=await window.cshell.cloudMcpClients({action:'create',name:name.trim(),bridgeId:bridge,scopes:['list_servers_page','connect','describe_connection','invoke_connection','disconnect','list_application_tools','describe_application_tool','invoke_application_tool']});setToken(result.token||'');setCopied(false);setName('');await refresh();})}>{zh?'创建令牌':'Create token'}</button></div></>}
 {token&&<div className="settings-card"><strong>{zh?'令牌仅显示此次，请妥善保存':'Token is shown only once. Store it securely.'}</strong><input aria-label="MCP token" readOnly type="password" value={token}/><button type="button" onClick={()=>void run(async()=>{await navigator.clipboard.writeText(token);setCopied(true);})}>{copied?(zh?'已复制':'Copied'):(zh?'复制令牌':'Copy token')}</button><button type="button" onClick={()=>setToken('')}>{zh?'隐藏并清除':'Dismiss token'}</button></div>}
 {data.clients?.filter(c=>!c.revoked).map(c=><div className="settings-row" key={c.id}><span>{c.name} · {new Date(c.expiresAt*1000).toLocaleDateString()}</span>{revoke===c.id?<><span>{zh?'撤销后将立即失效':'Revoke access now?'}</span><button type="button" disabled={busy} onClick={()=>void run(async()=>{await window.cshell.cloudMcpClients({action:'revoke',id:c.id});setRevoke('');await refresh();})}>{zh?'确认撤销':'Confirm revoke'}</button><button type="button" onClick={()=>setRevoke('')}>{zh?'取消':'Cancel'}</button></>:<button type="button" disabled={busy} onClick={()=>setRevoke(c.id)}>{zh?'撤销':'Revoke'}</button>}</div>)}
 </details>;
}
