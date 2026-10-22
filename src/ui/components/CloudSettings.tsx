import {AccountMemory} from './AccountMemory';
import {AccountImports} from './AccountImports';
import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Cloud, Eye, EyeOff, ShieldCheck, LogOut, Crown, Mail, LockKeyhole } from 'lucide-react';
import type { CloudStatus } from '../../shared/cloud-sync';
import brand from '../../../assets/brand/cshell-pro.svg';
const readable = (error: unknown) => {
  const message = String((error as Error)?.message || '').replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
  if (/fetch|network|timeout|net::|ECONN/i.test(message)) return '暂时无法连接，请检查网络后重试。';
  return message.replace(/^Error: /, '') || '暂时无法完成，请稍后重试。';
};
export function CloudSettings() {
  const [status, setStatus] = useState<CloudStatus>();
  const [registering,setRegistering]=useState(false),[verification,setVerification]=useState('');
  const [passwordMode, setPasswordMode] = useState(true), [visible, setVisible] = useState(false);
  const [email, setEmail] = useState(''), [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [cooldown, setCooldown] = useState(0), [logoutConfirm, setLogoutConfirm] = useState(false);
  const [direction, setDirection] = useState<'upload'|'download'>();
  useEffect(() => {
    let alive=true;
    const update=()=>window.cshell.cloudStatus().then(s=>{if(alive)setStatus(s);}).catch(()=>{});
    void update(); const timer=setInterval(update,2000);
    return()=>{alive=false;clearInterval(timer);};
  }, []);
  useEffect(()=>{if(!cooldown)return;const timer=setTimeout(()=>setCooldown(c=>c-1),1000);return()=>clearTimeout(timer);},[cooldown]);
  const run=async(action:()=>Promise<unknown>)=>{setBusy(true);setError('');setNotice('');try{await action();setStatus(await window.cshell.cloudStatus());}catch(e){setError(readable(e));}finally{setBusy(false);}};
  const backToLogin=()=>{setRegistering(false);setPasswordMode(true);setSecret('');setVerification('');setError('');setNotice('');};
  const login=()=>run(async()=>{if(registering)await window.cshell.cloudRegister(email,verification,secret);else await window.cshell.cloudLogin(status?.email || email,secret,passwordMode || !!status?.email);setSecret('');setVerification('');});
  const member=status?.membership;
  const active=!!member?.active && !!member.expiresAt && member.expiresAt*1000>Date.now();
  const offline=status?.state==='error', syncing=status?.state==='syncing';
  const syncLabel=status?.state==='conflict'?'有更改需要确认':offline?'连接暂时中断':syncing?'正在同步':status?.lastSync?'所有更改已同步':'正在准备同步';
  if (!status) return <section className="account-page-content" aria-label="正在加载账号"><div className="account-skeleton"/></section>;
  return <section className={'account-page-content '+(status.email?'signed-in':'signed-out')}>
    {!status.email ? <div className="auth-content">
      <button type="button" className="auth-back" hidden={!registering} disabled={busy} onClick={backToLogin}><ArrowLeft size={16}/>返回登录</button>
      <img className="auth-brand" src={brand} alt="CShell Pro"/>
      {status.workspaceRecovered&&<p className="account-recovery-note" role="status">已恢复到未登录工作区。原账号配置保留，重新登录即可继续。</p>}
      <h1>{registering?"创建 CShell 账号":"登录 CShell"}</h1><p className="auth-description">{registering?"一个账号，同步你的工作环境。":"在你的设备间，延续工作。"}</p>
      <form onSubmit={e=>{e.preventDefault();void login();}}>
        <fieldset disabled={busy}>
          <label htmlFor="account-email">邮箱地址</label><div className="auth-input"><Mail size={16}/><input id="account-email" type="email" autoComplete="email" placeholder="name@example.com" required value={email} onChange={e=>setEmail(e.target.value)}/></div>
          {registering&&<><div className="auth-label"><label htmlFor="account-verification">邮箱验证码</label></div><div className="auth-input"><Mail size={16}/><input id="account-verification" required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} placeholder="6 位验证码" value={verification} onChange={e=>setVerification(e.target.value)}/><button className="auth-link" type="button" disabled={cooldown>0} onClick={()=>{const input=document.getElementById('account-email') as HTMLInputElement;if(input.reportValidity())void run(async()=>{await window.cshell.cloudRequestCode(email);setCooldown(60);setNotice('验证码已发送，请查收邮件。');});}}>{cooldown?`${cooldown}s`:'发送验证码'}</button></div></>}
          <div className="auth-label"><label htmlFor="account-secret">{passwordMode?'密码':'邮箱验证码'}</label><button hidden={registering} className="auth-link" type="button" onClick={()=>{setPasswordMode(!passwordMode);setSecret('');setError('');setNotice('');}}>{passwordMode?'用验证码登录':'用密码登录'}</button></div>
          <div className="auth-input"><LockKeyhole size={16}/><input id="account-secret" type={passwordMode&&!visible?'password':'text'} autoComplete={registering?'new-password':passwordMode?'current-password':'one-time-code'} minLength={registering?8:undefined} inputMode={passwordMode?undefined:'numeric'} placeholder={registering?'设置密码，至少 8 个字符':passwordMode?'输入你的密码':'6 位验证码'} required maxLength={passwordMode?128:6} pattern={passwordMode?undefined:'[0-9]{6}'} value={secret} onChange={e=>setSecret(e.target.value)}/>{passwordMode?<button type="button" className="auth-eye" aria-label={visible?'隐藏密码':'显示密码'} onClick={()=>setVisible(!visible)}>{visible?<EyeOff size={16}/>:<Eye size={16}/>}</button>:<button className="auth-link" type="button" disabled={cooldown>0} onClick={()=>{const input=document.getElementById('account-email') as HTMLInputElement;if(input.reportValidity())void run(async()=>{await window.cshell.cloudRequestCode(email);setCooldown(60);setNotice('验证码已发送，请查收邮件。');});}}>{cooldown?`${cooldown}s`:'发送验证码'}</button>}</div>
          <button className="auth-submit" type="submit">{busy?registering?'正在创建…':'正在登录…':registering?'创建账号':'登录'}{!busy&&<ArrowRight size={16}/>}</button>
        </fieldset>
      </form>
      <p className="account-feedback" role={error?'alert':'status'}>{error || notice}</p>
      <div className="auth-footnote"><ShieldCheck size={14}/><span>登录后自动同步连接、模型与设置</span></div>
      <p className="auth-switch">{registering?"已有账号？":"还没有账号？"}<button type="button" className="auth-link" disabled={busy} onClick={()=>{setRegistering(!registering);setPasswordMode(true);setSecret('');setVerification('');setError('');setNotice('');}}>{registering?"登录":"创建账号"}</button></p>
    </div> : <>
      <div className="account-page-heading"><span>个人中心</span><span className="account-product">CShell Pro</span></div>
      <div className="account-identity"><div className="account-avatar">{status.email.slice(0,1).toUpperCase()}</div><div><h1>{status.email.split('@')[0]}{active&&<span className="account-pro-mark"><Crown size={12}/> PRO</span>}</h1><p>{status.email}</p></div></div>
      <div className={'account-sync-strip '+(offline?'offline':syncing?'syncing':'')} role="status"><span className="account-sync-icon">{offline||syncing?<Cloud size={17}/>:<Check size={17}/>}</span><div><strong>{syncLabel}</strong><p>{offline?'你的更改已保存在本机，网络恢复后自动同步。':status.lastSync?'最近同步于 '+new Date(status.lastSync).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})+' · 自动同步已开启':'正在自动恢复你的连接与设置'}</p></div></div>
      <div className="account-section"><h2>账户信息</h2><div className="account-detail-row"><span>邮箱</span><strong>{status.email}</strong></div><div className="account-detail-row"><span>当前方案</span>{member?<strong>{active?'Pro 会员':'免费账号'}{active&&<Crown size={14}/>}</strong>:<span className="account-loading-line" aria-label="正在获取方案"/>}</div>{active&&<div className="account-detail-row"><span>有效期</span><strong>{new Date(member!.expiresAt!*1000).toLocaleDateString()}</strong></div>}</div>
      <div className="account-section"><h2>跨设备同步 <ShieldCheck size={14}/></h2><div className="account-detail-row"><span>连接与已保存凭据</span><span className="account-included"><Check size={14}/> 自动同步</span></div><div className="account-detail-row"><span>基座模型与个人设置</span><span className="account-included"><Check size={14}/> 自动同步</span></div></div>
      {!status.unlocked&&<form className="account-exception" onSubmit={e=>{e.preventDefault();void login();}}><p>输入账号密码，恢复此设备上的加密配置。</p><input aria-label="账号密码" type="password" autoComplete="current-password" required value={secret} onChange={e=>setSecret(e.target.value)}/><button className="auth-submit" disabled={busy}>继续</button></form>}
      {status.state==='conflict'&&<div className="account-exception"><p>两台设备同时修改了配置。请选择保留哪一份；另一份会先备份。</p><button onClick={()=>setDirection('download')}>保留云端更改</button><button onClick={()=>setDirection('upload')}>保留此设备更改</button>{direction&&<div><p>确认使用{direction==='download'?'云端':'此设备'}配置？</p><button disabled={busy} onClick={()=>void run(async()=>{await window.cshell.cloudSync(direction);setDirection(undefined);})}>确认</button><button onClick={()=>setDirection(undefined)}>取消</button></div>}</div>}
      {status.storage&&<div className="account-section account-storage"><h2>云空间</h2><div className="account-detail-row"><span>连接、模型、扩展偏好与浏览器记录</span><strong>{(status.storage.usedBytes/1048576).toFixed(2)} / {Math.round(status.storage.limitBytes/1048576)} MiB</strong></div><progress aria-label="云空间用量" max={status.storage.limitBytes} value={status.storage.usedBytes}/><p>仅同步配置与记录，浏览器 Cookie、缓存和登录状态保留在本机。</p></div>}
      {status.unlocked&&<AccountImports key={status.email}/>}
      <AccountMemory/>
      <div className="account-footer"><span><ShieldCheck size={14}/> 配置已加密保护</span><button className="account-signout" onClick={()=>setLogoutConfirm(true)}><LogOut size={14}/>退出登录</button></div>
      {logoutConfirm&&<div className="account-exception"><p>退出后重新打开未登录工作区。账号数据保留，不会混入未登录数据。</p><button disabled={busy} onClick={()=>void run(async()=>{await window.cshell.cloudLogout();setLogoutConfirm(false);})}>确认退出</button><button onClick={()=>setLogoutConfirm(false)}>取消</button></div>}
      {error&&<p className="account-feedback" role="alert">{error}</p>}
    </>}
  </section>;
}
