import {useEffect, useRef, useState} from 'react';
import {AppWindow, ArrowUpRight, RefreshCw, Search} from 'lucide-react';
import type {AgentCall} from '../../shared/agent';
import {useI18n} from '../i18n';
import {ErrorNotice} from './ErrorNotice';
import './android-applications.css';

type PhoneApp = {id:string;name:string};
export function AndroidApplications({target,call}:{target:string;call:(method:AgentCall['method'],params?:unknown)=>Promise<unknown>}) {
  const cn=useI18n().locale==='zh-CN';
  const [apps,setApps]=useState<PhoneApp[]>([]),[query,setQuery]=useState(''),[busy,setBusy]=useState(false),[launching,setLaunching]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const generation=useRef(0);
  const refresh=async()=>{
    const current=++generation.current;setBusy(true);setError('');
    try {
      const response=await call('applications.list');
      if(!Array.isArray(response))throw new Error(cn?'手机未返回可用的应用列表。':'The phone did not return an application list.');
      const valid=response.filter((item):item is PhoneApp=>!!item&&typeof item.id==='string'&&typeof item.name==='string');
      if(current===generation.current)setApps(valid);
    } catch(e){if(current===generation.current)setError(String(e));}
    finally{if(current===generation.current)setBusy(false);}
  };
  useEffect(()=>{setApps([]);setQuery('');setNotice('');setLaunching('');void refresh();return()=>{generation.current++;};},[target,call]);
  const open=async(app:PhoneApp)=>{
    const current=generation.current;setLaunching(app.id);setError('');setNotice('');
    try {
      await call('packages.invoke',{packageId:'cagent.android',toolId:'android_app_launch',args:{packageName:app.id}});
      if(current===generation.current)setNotice(cn?`已向手机发送打开“${app.name}”的请求，可在远程控制中查看。`:`Sent a request to open ${app.name}. Check the phone in Remote control.`);
    } catch(e){if(current===generation.current)setError(String(e));}
    finally{if(current===generation.current)setLaunching('');}
  };
  const filtered=apps.filter(app=>(app.name+' '+app.id).toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <section className="android-applications" aria-label={cn?'手机应用':'Phone applications'}>
    <header><div><h2>{cn?'手机应用':'Phone applications'}</h2><p>{cn?'打开手机上已安装的应用。':'Open apps installed on this phone.'}</p></div><button type="button" className="android-app-refresh" disabled={busy||!!launching} title={cn?'刷新应用':'Refresh applications'} aria-label={cn?'刷新应用':'Refresh applications'} onClick={()=>void refresh()}><RefreshCw size={17}/></button></header>
    <label className="android-app-search"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder={cn?'搜索应用名称或包名':'Search name or package'} aria-label={cn?'搜索手机应用':'Search phone applications'}/></label>
    {error&&<ErrorNotice title={cn?'应用操作未完成':'Application action incomplete'} error={error}/>}
    {notice&&<p className="android-app-notice" role="status">{notice}</p>}
    {busy?<p role="status">{cn?'正在读取手机应用…':'Loading phone applications…'}</p>:<div className="android-app-grid">{filtered.map(app=><button type="button" className="android-app-item" key={app.id} disabled={!!launching} title={app.name+' · '+app.id} onClick={()=>void open(app)}><span className="android-app-symbol"><AppWindow size={23}/></span><span className="android-app-copy"><strong>{app.name}</strong><small>{launching===app.id?(cn?'正在打开…':'Opening…'):app.id}</small></span><ArrowUpRight size={15}/></button>)}</div>}
    {!busy&&!error&&!filtered.length&&<div className="android-app-empty"><AppWindow size={32}/><p>{query?(cn?'没有匹配的应用':'No matching applications'):(cn?'手机暂未返回可启动的应用。':'No launchable applications returned by the phone.')}</p></div>}
  </section>;
}
