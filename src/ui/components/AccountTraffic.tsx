import {useEffect,useState} from 'react';
import {Activity,ArrowDown,ArrowUp,RefreshCw} from 'lucide-react';
import {useI18n} from '../i18n';
import type {AccountTraffic as Traffic} from '../../shared/account-traffic';
import {formatFileBytes} from '../../shared/transfer-progress';
import {ErrorNotice} from './ErrorNotice';
import './account-traffic.css';

export function AccountTraffic(){
 const cn=useI18n().locale==='zh-CN',t=(zh:string,en:string)=>cn?zh:en;
 const [data,setData]=useState<Traffic>(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0);
 useEffect(()=>{let alive=true,pending=false;const refresh=async()=>{if(pending)return;pending=true;if(alive)setBusy(true);try{const value=await window.cshell.cloudTraffic();if(alive){setData(value);setError('');}}catch(e){if(alive)setError(String(e));}finally{pending=false;if(alive)setBusy(false);}};void refresh();const timer=setInterval(()=>void refresh(),30000);return()=>{alive=false;clearInterval(timer);};},[revision]);
 return <section className="account-section account-traffic" aria-label={t('本月流量','Monthly traffic')}><header><div><h2><Activity size={15}/>{t('本月流量','Monthly traffic')}</h2><small>{data?`${data.period} · UTC`:t('正在获取账号用量','Loading account usage')}</small></div><button className="icon" type="button" disabled={busy} title={t('刷新流量','Refresh traffic')} aria-label={t('刷新流量','Refresh traffic')} onClick={()=>setRevision(v=>v+1)}><RefreshCw size={15} className={busy?'spinning':undefined}/></button></header>
 {error&&<ErrorNotice title={t('暂时无法获取流量','Traffic temporarily unavailable')} error={error}/>}
 {data?<><div className="account-traffic-grid">{data.channels.map(row=><article key={row.category}><div className="account-traffic-title"><strong>{row.category==='relay'?t('机器中继','Machine relay'):'MCP'}</strong><span>{row.remainingBytes===null?t('未设上限','No configured limit'):t('可用 ','Available ')+formatFileBytes(row.remainingBytes)}</span></div><div className="account-traffic-amount"><b>{formatFileBytes(row.usedBytes)}</b><span>/ {row.limitBytes===null?t('按现有权益','Existing entitlement'):formatFileBytes(row.limitBytes)}</span></div>{row.limitBytes!==null&&<progress aria-label={(row.category==='relay'?t('中继','Relay'):'MCP')+t('流量用量',' traffic usage')} value={Math.min(row.limitBytes,row.usedBytes+row.reservedBytes)} max={Math.max(1,row.limitBytes)}/>}
 <dl><div><dt><ArrowUp size={12}/>{t('上传','Upload')}</dt><dd>{formatFileBytes(row.ingressBytes)}</dd></div><div><dt><ArrowDown size={12}/>{t('下载','Download')}</dt><dd>{formatFileBytes(row.egressBytes)}</dd></div><div><dt title={t('正在进行的操作已预留预算，完成后按实际流量结算并释放余量','Active operations reserve a budget; unused bytes are released after settlement')}>{t('在途预留','Reserved')}</dt><dd>{formatFileBytes(row.reservedBytes)}</dd></div>{row.addonBytes>0&&<div><dt>{t('本月扩容','Monthly add-on')}</dt><dd>+{formatFileBytes(row.addonBytes)}</dd></div>}</dl></article>)}</div><p className="account-traffic-note">{t('按 UTC 自然月结算，可用量已扣除在途预留。未设置上限时保留现有权益。','UTC calendar month. Available bytes exclude reservations. Unconfigured limits preserve existing entitlements.')}{error&&t(' 当前显示上次成功获取的数据。',' Showing the last successful snapshot.')}</p></>:!error&&<p role="status">{t('正在读取…','Loading…')}</p>}</section>;
}
