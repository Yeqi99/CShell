import {useRef, useState} from 'react';
import {Globe, Plus, RefreshCw, Pencil, Trash2} from 'lucide-react';
import type {MemberDomainCommand, MemberDomainState} from '../../shared/member-domains';
import {ErrorNotice} from './ErrorNotice';
import {useI18n} from '../i18n';
import './member-domains.css';

type DomainMutation<T=MemberDomainCommand> = T extends unknown ? Omit<T,'requestId'> : never;
export function MemberDomains() {
  const {locale}=useI18n(), zh=locale==='zh-CN', t=(cn:string,en:string)=>zh?cn:en;
  const [data,setData]=useState<MemberDomainState>(),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [prefix,setPrefix]=useState(''),[rename,setRename]=useState(false),[editing,setEditing]=useState<string>(),[deleting,setDeleting]=useState('');
  const [name,setName]=useState('@'),[type,setType]=useState<'A'|'AAAA'|'CNAME'|'TXT'|'MX'>('A'),[content,setContent]=useState(''),[priority,setPriority]=useState(10);
  const pending=useRef<{key:string;id:string}|undefined>(undefined);
  const refresh=async()=>setData(await window.cshell.cloudDomains());
  const run=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');try{await fn();}catch(e){setError(String((e as Error).message));}finally{setBusy(false);}};
  const mutate=async(body:DomainMutation)=>{
    const key=JSON.stringify(body);if(pending.current?.key!==key)pending.current={key,id:crypto.randomUUID()};
    setData(await window.cshell.cloudDomains({...body,requestId:pending.current.id} as MemberDomainCommand));pending.current=undefined;
  };
  const current=data?.domains.find(d=>!d.retired);
  return <details className="member-domains account-section" onToggle={e=>{if(e.currentTarget.open&&!data&&!busy)void run(refresh);}}>
    <summary><Globe size={18}/><span>{t('会员域名','Member domain')}</span><small>canp.site</small></summary>
    <div className="member-domain-body">
      <header><div><h3>{current?.domain||t('为你的网站认领一个地址','Claim an address for your website')}</h3><p>{t('域名随账号保存。子域名和解析记录可以在这里管理，也可以交给智能体。','Your domain belongs to your account. Manage DNS here or through your agent.')}</p></div><button className="domain-icon" type="button" aria-label={t('刷新域名','Refresh domains')} title={t('刷新域名','Refresh domains')} disabled={busy} onClick={()=>void run(refresh)}><RefreshCw size={16}/></button></header>
      {error&&<ErrorNotice error={error} title={t('域名操作未完成','Domain operation incomplete')}/>}
      {!data&&<p role="status">{busy?t('正在读取…','Loading…'):t('暂未读取域名','Domain not loaded')}</p>}
      {data&&!data.membershipActive&&<p className="domain-notice">{t('认领和修改解析需要有效会员，已有域名与解析会保留。','An active membership is required to claim or edit DNS. Existing records are retained.')}</p>}
      {data&&(data.capabilities.claim||rename)&&<form onSubmit={e=>{e.preventDefault();void run(async()=>{await mutate({action:current?'rename':'claim',prefix} as DomainMutation);setRename(false);setPrefix('');});}}><label>{t('域名前缀','Domain prefix')}<div className="domain-prefix"><input required pattern="[a-zA-Z][a-zA-Z0-9-]{1,30}[a-zA-Z0-9]" maxLength={32} value={prefix} onChange={e=>setPrefix(e.target.value)} autoCapitalize="none"/><span>.canp.site</span></div></label><p>{t('名称全站唯一。每个自然月可改名一次；改名不会迁移网站，旧解析会保留。','Names are unique. Rename once per calendar month; existing sites and DNS are not migrated.')}</p><div className="domain-actions"><button disabled={busy} type="submit">{current?t('确认改名','Confirm rename'):t('认领域名','Claim domain')}</button>{rename&&<button type="button" onClick={()=>setRename(false)}>{t('取消','Cancel')}</button>}</div></form>}
      {current&&!rename&&<div className="domain-actions"><button type="button" disabled={busy||!data?.capabilities.rename} onClick={()=>{setPrefix(current.prefix);setRename(true);}}>{t('更改域名','Rename')}</button>{data?.nextRenameAt&&<small>{t('下次可改名：','Next rename: ')}{new Date(data.nextRenameAt*1000).toLocaleDateString(locale,{timeZone:'Asia/Shanghai'})}</small>}</div>}
      {current&&<section className="domain-records"><header><h3>{t('DNS 解析','DNS records')}</h3><button type="button" disabled={busy||!data?.capabilities.writeDns} onClick={()=>{setEditing('new');setName('@');setType('A');setContent('');setPriority(10);}}><Plus size={15}/>{t('添加解析','Add record')}</button></header>
        {editing&&<form onSubmit={e=>{e.preventDefault();void run(async()=>{const recordName=name==='@'?'@':name.endsWith('.'+current.domain)||name===current.domain?name:name+'.'+current.domain;await mutate({action:editing==='new'?'create':'update',...(editing==='new'?{prefix:current.prefix}:{id:editing,ttl:data?.records.find(r=>r.id===editing)?.ttl}),name:recordName,type,content,...(type==='MX'?{priority}:{})} as DomainMutation);setEditing(undefined);});}}><div className="domain-fields"><label>{t('主机名','Host')}<input required value={name} onChange={e=>setName(e.target.value)} placeholder="www"/></label><label>{t('类型','Type')}<select value={type} onChange={e=>setType(e.target.value as typeof type)}>{['A','AAAA','CNAME','TXT','MX'].map(v=><option key={v}>{v}</option>)}</select></label><label className="domain-value">{t('记录值','Value')}<input required maxLength={2048} value={content} onChange={e=>setContent(e.target.value)}/></label>{type==='MX'&&<label>{t('优先级','Priority')}<input type="number" min={0} max={65535} value={priority} onChange={e=>setPriority(Number(e.target.value))}/></label>}</div><small>{t('@ 表示当前域名；www 表示 www.','@ means the current domain; www means www.')}{current.domain}</small><div className="domain-actions"><button disabled={busy} type="submit">{t('保存解析','Save record')}</button><button type="button" onClick={()=>setEditing(undefined)}>{t('取消','Cancel')}</button></div></form>}
        {data?.records.length===0&&<p className="domain-empty">{t('还没有解析记录。部署网站后，添加指向目标机器的 A 或 AAAA 记录。','No records yet. After deploying your site, add an A or AAAA record pointing to its host.')}</p>}
        {data?.records.map(r=><article className="domain-record" key={r.id}><span className="domain-record-type">{r.type}</span><div><strong>{r.name}</strong><code>{r.content}</code>{r.prefix!==current.prefix&&<small>{t('保留的旧域名','Retained previous domain')}</small>}</div><div className="domain-actions"><button className="domain-icon" type="button" disabled={busy||!data.capabilities.writeDns||r.prefix!==current.prefix} aria-label={t('编辑 ','Edit ')+r.name+' '+r.type} onClick={()=>{setEditing(r.id);setName(r.name);setType(r.type);setContent(r.content);setPriority(r.priority??10);}}><Pencil size={15}/></button><button className="domain-icon" type="button" disabled={busy||!data.capabilities.deleteDns} aria-label={t('删除 ','Delete ')+r.name+' '+r.type} onClick={()=>setDeleting(r.id)}><Trash2 size={15}/></button></div>{deleting===r.id&&<div className="domain-delete"><p>{t('删除这条解析可能使网站或邮箱不可访问。','Deleting this record can interrupt your website or email.')}</p><button disabled={busy} onClick={()=>void run(async()=>{await mutate({action:'delete',id:r.id} as DomainMutation);setDeleting('');})}>{t('确认删除','Delete record')}</button><button onClick={()=>setDeleting('')}>{t('取消','Cancel')}</button></div>}</article>)}
      </section>}
      <details className="domain-guide"><summary>{t('让智能体建站','Build a site with your agent')}</summary><p>{t('告诉智能体网站用途、目标机器和要使用的域名。智能体会先检查部署环境，再配置解析、HTTPS 和续签；服务器需要能够被公网访问。','Tell your agent the website purpose, target machine and domain. It checks the host before configuring DNS, HTTPS and renewal; the host must be publicly reachable.')}</p><code>{t('在我的机器上部署网站，使用我的 canp.site 域名，并验证 HTTPS 与自动续签。','Deploy my website on my machine using my canp.site domain. Verify HTTPS and automatic renewal.')}</code></details>
    </div>
  </details>;
}
