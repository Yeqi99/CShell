import {ProPurchase} from './ProPurchase';
import {useEffect,useState} from 'react';
import {Activity,ArrowDown,ArrowUp,Coins,RefreshCw} from 'lucide-react';
import {useI18n} from '../i18n';
import type {AccountTraffic as Traffic} from '../../shared/account-traffic';
import {formatFileBytes} from '../../shared/transfer-progress';
import {ErrorNotice} from './ErrorNotice';
import './account-traffic.css';

export function AccountTraffic({email,active=false}:{email?:string;active?:boolean}){
 const cn=useI18n().locale==='zh-CN',t=(zh:string,en:string)=>cn?zh:en;
 const [data,setData]=useState<Traffic>(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0);
 useEffect(()=>{let alive=true,pending=false;const refresh=async()=>{if(pending)return;pending=true;if(alive)setBusy(true);try{const value=await window.cshell.cloudTraffic();if(alive){setData(value);setError('');}}catch(e){if(alive)setError(String(e));}finally{pending=false;if(alive)setBusy(false);}};void refresh();const timer=setInterval(()=>void refresh(),30000);return()=>{alive=false;clearInterval(timer);};},[revision]);
 return <section className="account-section account-traffic" aria-label={t('点数与用量','Points and usage')}><header><div><h2><Activity size={15}/>{t('点数与用量','Points and usage')}</h2><small>{data?`${data.period} · UTC`:t('正在获取账号用量','Loading account usage')}</small></div><button className="icon" type="button" disabled={busy} title={t('刷新余额与用量','Refresh balance and usage')} aria-label={t('刷新余额与用量','Refresh balance and usage')} onClick={()=>setRevision(v=>v+1)}><RefreshCw size={15} className={busy?'spinning':undefined}/></button></header>
 {error&&<ErrorNotice title={t('暂时无法获取账号用量','Account usage temporarily unavailable')} error={error}/>}
 {data?<>{data.modelWeek&&<MemberWallet email={email} active={active} week={data.modelWeek} cn={cn} refresh={()=>setRevision(v=>v+1)}/>}<h3>{t('本月流量','Monthly traffic')}</h3><div className="account-traffic-grid">{data.channels.map(row=><article key={row.category}><div className="account-traffic-title"><strong>{row.category==='relay'?t('机器中继','Machine relay'):'MCP'}</strong><span>{row.remainingBytes===null?t('未设上限','No configured limit'):t('可用 ','Available ')+formatFileBytes(row.remainingBytes)}</span></div><div className="account-traffic-amount"><b>{formatFileBytes(row.usedBytes)}</b>{row.limitBytes!==null&&<span>/ {formatFileBytes(row.limitBytes)}</span>}</div>{row.limitBytes!==null&&<progress aria-label={(row.category==='relay'?t('中继','Relay'):'MCP')+t('流量用量',' traffic usage')} value={Math.min(row.limitBytes,row.usedBytes+row.reservedBytes)} max={Math.max(1,row.limitBytes)}/>}
 <dl><div><dt><ArrowUp size={12}/>{t('上传','Upload')}</dt><dd>{formatFileBytes(row.ingressBytes)}</dd></div><div><dt><ArrowDown size={12}/>{t('下载','Download')}</dt><dd>{formatFileBytes(row.egressBytes)}</dd></div><div><dt title={t('正在进行的操作已预留预算，完成后按实际流量结算并释放余量','Active operations reserve a budget; unused bytes are released after settlement')}>{t('在途预留','Reserved')}</dt><dd>{formatFileBytes(row.reservedBytes)}</dd></div>{row.addonBytes>0&&<div><dt>{t('本月扩容','Monthly add-on')}</dt><dd>+{formatFileBytes(row.addonBytes)}</dd></div>}</dl></article>)}</div><p className="account-traffic-note">{t('按 UTC 自然月结算，可用流量已扣除在途预留。','UTC calendar month. Available traffic excludes reservations.')}{error&&t(' 当前显示上次成功获取的数据。',' Showing the last successful snapshot.')}</p></>:!error&&<p role="status">{t('正在读取…','Loading…')}</p>}</section>;
}

function MemberWallet({week,cn,refresh,email,active}:{email?:string;active:boolean;week:NonNullable<Traffic['modelWeek']>;cn:boolean;refresh:()=>void}){
 const t=(zh:string,en:string)=>cn?zh:en;
 const [offer,setOffer]=useState<{quote:string;request:string}>(),[sending,setSending]=useState(false),[notice,setNotice]=useState('');
 const minutes=Math.max(0,Math.ceil(((week.resetAt||0)*1000-Date.now())/60000));
 async function pay(){if(!offer||sending)return;setSending(true);try{await window.cshell.cloudRefill(offer.quote,offer.request);setNotice(t('周额度已重置','Weekly allowance restored'));setOffer(undefined)}catch(e){setNotice(String(e))}finally{setSending(false);refresh()}}
 return <section className="member-wallet">
   <div className="wallet-balance">
     <span className="wallet-label"><Coins size={15}/>{t('点数余额','Points balance')}</span>
     <div className="wallet-figure"><strong>{week.balance?.toLocaleString()??'—'}</strong><span>{t('点','pts')}</span></div>
     {email&&<details className="wallet-rewards"><summary>{t('邀请好友与礼品卡','Invitations and gift cards')}</summary>
       <button type="button" onClick={()=>void window.cshell.cloudInvitePoster().catch(e=>setNotice(String(e)))}>{t('生成邀请海报','Create invitation poster')}</button>
       <form onSubmit={async event=>{event.preventDefault();const form=event.currentTarget;if(sending)return;setSending(true);try{const r=await window.cshell.cloudRedeemGift(email,String(new FormData(form).get('code')).trim());form.reset();setNotice(r.kind==='points'?t('已领取 ','Received ')+r.quantity+t(' 点',' points'):r.kind==='membership'?r.plan+' · '+r.quantity+t(' 天',' days'):t('本周额度已重置','Weekly allowance restored'));refresh()}catch(e){setNotice(String(e))}finally{setSending(false)}}}>
       <input name="code" aria-label={t('礼品卡兑换码','Gift code')} placeholder={t('礼品卡兑换码','Gift code')} maxLength={32} pattern="[A-Fa-f0-9]{32}" required/><button disabled={sending}>{t('兑换','Redeem')}</button></form></details>}
     {email&&<WalletSpending key={email} cn={cn}/>}
     {email&&<ProPurchase email={email} active={active} balance={week.balance} cn={cn} refresh={refresh}/>}
   </div>
   {week.percent!==undefined && <div className="wallet-week">
     <div className="wallet-week-title"><strong>{t('Pro 周额度','Pro weekly allowance')}</strong><span>{t('剩余','Remaining')} <b>{Math.floor(week.percent*100)/100}%</b></span></div>
     <progress aria-label={t('周额度剩余','Weekly allowance remaining')} max={100} value={week.percent}/>
     <small title={t('每周一北京时间 00:00 刷新','Resets Monday at 00:00 Beijing time')}>{t('距下次刷新','Resets in')} {Math.floor(minutes/1440)}{t('天','d')} {Math.floor(minutes%1440/60)}{t('小时','h')} {minutes%60}{t('分钟','m')}</small>
     <div className="wallet-actions">
       {offer ? <><span>{t('确认扣除','Spend')} {week.price} {t('点恢复至 100%？','points to restore 100%?')}</span>
         <button type="button" disabled={sending||offer.quote!==week.quote} onClick={()=>void pay()}>{t('确认重置','Confirm')}</button>
         <button type="button" disabled={sending} onClick={()=>setOffer(undefined)}>{t('取消','Cancel')}</button></>
       : <button type="button" disabled={!week.quote||(week.balance??0)<(week.price??Infinity)} onClick={()=>week.quote&&setOffer({quote:week.quote,request:crypto.randomUUID()})}>{week.price===undefined?'':week.price+' '+t('点 · ','pts · ')}{t('重置周额度','Restore weekly allowance')}</button>}
     </div>
   </div>}
   {notice&&<p role="status">{notice}</p>}
 </section>;
}

function WalletSpending({cn}:{cn:boolean}) {
 const [enabled,setEnabled]=useState<boolean>();
 const [saving,setSaving]=useState(false);
 const [error,setError]=useState('');
 const [attempt,retry]=useState(0);
 useEffect(()=>{
   let alive=true;
   window.cshell.cloudAgentSpending().then(value=>{if(alive){setEnabled(value.enabled);setError('');}}).catch(reason=>{if(alive)setError(String(reason));});
   return ()=>{alive=false;};
 },[attempt]);
 async function toggle() {
   if(enabled===undefined || saving)return;
   setSaving(true);
   try {setEnabled((await window.cshell.cloudAgentSpending(!enabled)).enabled);setError('');}
   catch(reason){setError(String(reason));}
   finally{setSaving(false);}
 }
 return <div className="wallet-spending">
   <button type="button" role="switch" aria-checked={enabled===true} aria-busy={saving} disabled={enabled===undefined||saving} onClick={()=>void toggle()}>
     <span>{cn?'智能体自动消费':'Agent spending'}</span><i aria-hidden="true"/>
   </button>
   <small>{saving?(cn?'正在保存…':'Saving…'):(cn?'允许使用点数开通服务、租赁及扩容机器':'Allow service purchases, machine rentals and upgrades.')}</small>
   {error&&<small role="alert">{error} <button type="button" onClick={()=>retry(n=>n+1)}>{cn?'重试':'Retry'}</button></small>}
 </div>;
}
