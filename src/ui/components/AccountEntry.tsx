import { useEffect, useState } from 'react';
import { UserRound, FolderInput, X } from 'lucide-react';
import type {AccountSource} from '../../shared/account-import';
import type { CloudStatus } from '../../shared/cloud-sync';
export function AccountEntry({onOpen}: {onOpen: () => void}) {
  const [status,setStatus]=useState<CloudStatus>();
  const [sources,setSources]=useState<AccountSource[]>([]);
  useEffect(()=>{
    let alive=true;setSources([]);
    if(status?.email&&status.unlocked&&window.cshell.accountSources&&!localStorage.getItem('account-source-notice-v1')){
      void window.cshell.accountSources().then(value=>{if(alive)setSources(value);}).catch(()=>{});
    }
    return()=>{alive=false;};
  },[status?.email,status?.unlocked]);
  const dismiss=()=>{localStorage.setItem('account-source-notice-v1','seen');setSources([]);};
  useEffect(()=>{let alive=true;const update=()=>window.cshell.cloudStatus().then(s=>{if(alive)setStatus(s);}).catch(()=>{});void update();const timer=setInterval(update,5000);return()=>{alive=false;clearInterval(timer);};},[]);
  const active=!!status?.membership?.active && !!status.membership.expiresAt && status.membership.expiresAt*1000>Date.now();
  return <div className="account-entry-wrap"><button className="account-entry" onClick={onOpen} title={status?.email || '登录账号'} aria-label="账号与会员">{status?.email?<span className="account-entry-avatar">{status.email.slice(0,1).toUpperCase()}</span>:<UserRound size={16}/>}<span>{status?.email?.split('@')[0] || '登录'}</span>{active&&<span className="account-pro-mark">PRO</span>}</button>{sources.length>0&&<aside className="account-source-notice" aria-label="发现本机配置" role="status"><FolderInput size={18}/><div><strong>有本机配置可以载入</strong><p>{sources.map(s=>s==='opensource'?'CShell 开源版':'Pro 未登录工作区').join('、')}</p><button onClick={()=>{dismiss();onOpen();}}>查看并选择</button><button onClick={dismiss}>以后再说</button></div><button className="icon" title="关闭配置提示" aria-label="关闭配置提示" onClick={dismiss}><X size={14}/></button></aside>}</div>;
}
