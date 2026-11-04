import { useEffect, useState } from 'react';
import { Cloud, ExternalLink, RefreshCw, Unplug, CheckCircle2 } from 'lucide-react';
import { useI18n } from '../../ui/i18n';
import { ErrorNotice } from '../../ui/components/ErrorNotice';
import './view.css';
type Status = { authorized: boolean; connected: boolean; pending: boolean; tools: string[]; error: string };
const call = (action: string) => window.cshell.aiExtensionCall('cshell.cloudflare', action) as Promise<Status>;
export function CloudflareView() {
  const { locale } = useI18n(); const zh = locale === 'zh-CN';
  const [state, setState] = useState<Status>({authorized:false,connected:false,pending:false,tools:[],error:''});
  const [busy,setBusy] = useState(false), [error,setError] = useState('');
  useEffect(() => { let alive = true; const update = () => void call('status').then(s => {if(alive)setState(s);}).catch(() => {}); update(); const timer=setInterval(update,2000); return()=>{alive=false;clearInterval(timer);}; },[]);
  const run = async (action:string) => {setBusy(true);setError('');try{setState(await call(action));}catch{setError(zh?'Cloudflare 连接未完成，请检查网络或重新授权。':'Cloudflare could not connect. Check your network or authorize again.');}finally{setBusy(false);}};
  return <section className="cloudflare-extension">
    <header><div className="cloudflare-emblem"><Cloud size={30}/></div><div><h2>Cloudflare</h2><p>{zh?'从一个需求，到可以访问的网站。':'From an idea to a live website.'}</p></div></header>
    <div className="cloudflare-connection">
      <div className="cloudflare-state"><CheckCircle2 size={18}/><strong>{state.pending?(zh?'等待浏览器授权':'Waiting for authorization'):state.connected?(zh?'已连接':'Connected'):state.authorized?(zh?'已保存授权':'Authorization saved'):(zh?'连接你的 Cloudflare':'Connect your Cloudflare')}</strong></div>
      <p>{zh?'在 Cloudflare 官方页面选择账号和授权范围。授权完成后，智能体即可查询资源、创建站点并部署；执行遵循当前对话的审核设置。':'Choose your account and permissions on Cloudflare. Your agent can then inspect resources and deploy sites, following the conversation’s approval settings.'}</p>
      <div className="cloudflare-actions"><button className="primary" disabled={busy||state.pending} onClick={()=>void run('authorize')}><ExternalLink size={16}/>{state.authorized?(zh?'重新授权':'Authorize again'):(zh?'授权并启用智能体工具':'Authorize agent tools')}</button>
      {state.authorized&&<button disabled={busy||state.pending} onClick={()=>void run('refresh')}><RefreshCw size={16}/>{zh?'检查连接':'Check connection'}</button>}
      {(state.authorized||state.pending)&&<button disabled={busy} onClick={()=>void run('disconnect')}><Unplug size={16}/>{zh?'断开授权':'Disconnect'}</button>}</div>
      <small>{zh?'授权信息在本机加密保存，不会出现在对话中。断开会删除本机授权；彻底撤销可在 Cloudflare 管理已授权应用。':'Credentials are encrypted locally and never included in chat. Disconnect removes local credentials; revoke the application in Cloudflare to fully withdraw access.'}</small>
      {state.pending&&<div role="status"><p>{zh?'请在刚打开的同一个浏览器和用户配置中完成授权，不要复制中途的授权地址到其他浏览器。若出现“authorization was not started in this browser”，关闭错误页并重新开始。':'Complete authorization in the browser and profile just opened. Do not move an intermediate authorization URL to another browser. If it says “authorization was not started in this browser”, close that error page and start again.'}</p><button disabled={busy} onClick={()=>void run('restart')}><RefreshCw size={16}/>{zh?'重新开始授权':'Restart authorization'}</button></div>}
    </div>
    <ErrorNotice title={zh?'Cloudflare 未就绪':'Cloudflare unavailable'} error={error||state.error}/>
    <div className="cloudflare-workflow"><h3>{zh?'直接告诉智能体你要做什么':'Tell your agent what to build'}</h3><p>{zh?'“创建一个个人作品网站，部署到 Cloudflare，并把访问地址给我。”':'“Build my portfolio, deploy it on Cloudflare and give me the live URL.”'}</p><ol><li>{zh?'查询账号与现有资源':'Inspect account and resources'}</li><li>{zh?'生成内容并部署':'Build and deploy'}</li><li>{zh?'核验网址与部署结果':'Verify the live URL'}</li></ol></div>
    {state.tools.length>0&&<details><summary>{zh?'已接入的官方工具':'Connected official tools'} · {state.tools.length}</summary><p>{state.tools.join(' · ')}</p></details>}
  </section>;
}
