import { useEffect, useState } from 'react';
import { UserRound } from 'lucide-react';
import type { CloudStatus } from '../../shared/cloud-sync';
export function AccountEntry({onOpen}: {onOpen: () => void}) {
  const [status,setStatus]=useState<CloudStatus>();
  useEffect(()=>{let alive=true;const update=()=>window.cshell.cloudStatus().then(s=>{if(alive)setStatus(s);}).catch(()=>{});void update();const timer=setInterval(update,5000);return()=>{alive=false;clearInterval(timer);};},[]);
  const active=!!status?.membership?.active && !!status.membership.expiresAt && status.membership.expiresAt*1000>Date.now();
  return <button className="account-entry" onClick={onOpen} title={status?.email || '登录账号'} aria-label="账号与会员">{status?.email?<span className="account-entry-avatar">{status.email.slice(0,1).toUpperCase()}</span>:<UserRound size={16}/>}<span>{status?.email?.split('@')[0] || '登录'}</span>{active&&<span className="account-pro-mark">PRO</span>}</button>;
}
