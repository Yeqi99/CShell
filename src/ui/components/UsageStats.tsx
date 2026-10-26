import {useEffect,useState} from 'react';
// GitHub owns the public presentation. The client only offers local consent.
export function UsageConsent({english,active}:{english:boolean;active:boolean}) {
 const [enabled,setEnabled]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const t=(zh:string,en:string)=>english?en:zh;
 useEffect(()=>{if(!active || !window.cshell.usageRead)return;let disposed=false;void window.cshell.usageRead().then(value=>{if(!disposed)setEnabled(value.enabled);}).catch(()=>{if(!disposed)setError(t('无法读取本机设置','Cannot read local settings'));});return()=>{disposed=true;};},[active,english]);
 if(!window.cshell.usageRead)return null;
 return <section className="settings-section usage-consent"><h3>{t('匿名统计偏好','Anonymous reporting preference')}</h3>
 <label><input type="checkbox" checked={enabled} disabled={busy} onChange={async e=>{const next=e.target.checked;setEnabled(next);setBusy(true);try{await window.cshell.usageConsent?.(next);setError('');}catch{setEnabled(!next);setError(t('保存失败，请重试','Save failed. Retry.'));}finally{setBusy(false);}}}/>{t('自愿参与匿名设备统计','Participate in anonymous device counts')}</label>
 <p className="muted">{t('为 GitHub 的活跃设备徽章提供匿名计数，默认关闭、修改立即生效。不上传机器名称、文件、命令或对话内容。此选择仅保存在本机。','Provide anonymous counts for the GitHub activity badge. Off by default; changes apply immediately and stay on this device. No machine names, files, commands or conversations are uploaded.')}</p>
 <details><summary>{t('退出与数据保留','Opt-out and retention')}</summary><p className="muted">{t('关闭后停止心跳并请求删除记录；断网时将在下次联网重试。离线超过 5 分钟不计活跃，30 天未活跃的匿名记录自动清理。','Turning off stops heartbeats and requests deletion, retried when online. Presence expires after 5 minutes; anonymous records expire after 30 days.')}</p></details>
 {error&&<p role="status">{error}</p>}
 </section>;
}
