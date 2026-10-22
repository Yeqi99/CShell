import { useEffect, useState } from 'react';
import { UserRound } from 'lucide-react';
import type { CloudStatus } from '../../shared/cloud-sync';
export function AccountEntry({onOpen}: {onOpen: () => void}) {
  const [status,setStatus]=useState<CloudStatus>();
  useEffect(()=>{let alive=true;const update=()=>window.cshell.cloudStatus().then(s=>{if(alive)setStatus(s);}).catch(()=>{});void update();const timer=setInterval(update,5000);return()=>{alive=false;clearInterval(timer);};},[]);
  return <button className="account-entry" onClick={onOpen} title={status?.email || '登录账号，自动同步'} aria-label="账号与会员"><UserRound size={17}/><span>{status?.email?.split('@')[0] || '登录 / 注册'}</span>{status?.email && <span className={'member-badge'+(status.membership?.active?' active':'')}>{status.membership ? status.membership.active?'PRO':'普通账号':'待刷新'}</span>}</button>;
}
