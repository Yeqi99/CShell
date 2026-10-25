import { useEffect, useState } from 'react';
import { ArrowLeft, Download, Package, RefreshCw } from 'lucide-react';
import { applications, type ApplicationId, type EnvironmentSnapshot, type InstallationPlan, type RemoteJob } from '../../shared/plugins';
import { ErrorNotice } from './ErrorNotice';

/** Uses the same authenticated SSH application service as the terminal workbench.
 * It does not change, impersonate or infer the Agent's application permissions. */
export function SshApplicationMarket({ sessionId, name }: { sessionId: string; name: string }) {
  const [selected, setSelected] = useState<ApplicationId>(), [plan, setPlan] = useState<InstallationPlan>(),
    [environment, setEnvironment] = useState<EnvironmentSnapshot>(), [python, setPython] = useState(''),
    [environmentName, setEnvironmentName] = useState('cshell-python'), [version, setVersion] = useState<'3.11'|'3.12'|'3.13'|'3.14'>('3.12'),
    [jobs, setJobs] = useState<RemoteJob[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await fn(); } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    let disposed = false, pending = false;
    const poll = async () => { if(pending)return;pending=true;try{const next=await window.cshell.jobs(sessionId);if(!disposed)setJobs(next);}catch(error){if(!disposed)setError(String(error));}finally{pending=false;} };
    void poll(); const timer=setInterval(()=>void poll(),2000);
    return()=>{disposed=true;clearInterval(timer);};
  },[sessionId]);
  const inspect = async () => {
    const next = await window.cshell.environments(sessionId); setEnvironment(next);
    setPython(previous => previous && (next.python===previous||next.environments.some(e=>e.python===previous)) ? previous : next.environments[0]?.python||next.python||'');
    setPlan(undefined);
  };
  const choose = (id: ApplicationId) => {setSelected(id);setPlan(undefined);setError('');if(['python','jupyter','jedi'].includes(id))void run(inspect);};
  const app=applications.find(a=>a.id===selected), running=jobs.some(j=>j.state==='running');
  const interpreters=[...new Set([environment?.python,...(environment?.environments.map(e=>e.python)||[])].filter((v):v is string=>!!v))];
  return <section className="development-market ssh-application-market">
    <header><div><h3>服务器应用</h3><p>通过当前 SSH 连接安装到 {name}。</p></div></header>
    {error&&<ErrorNotice title="应用操作未完成" error={error}/>}
    {app ? <div className="development-detail">
      <button className="development-back" onClick={()=>{setSelected(undefined);setPlan(undefined);}}><ArrowLeft size={16}/>服务器应用</button>
      <h3>{app.name}</h3><p>{app.description}</p>
      {['python','jupyter','jedi'].includes(app.id)&&<>
        <button disabled={busy||running} onClick={()=>void run(inspect)}><RefreshCw size={15}/>检查目标环境</button>
        {app.id==='python'?<p>{environment?.conda?`Conda：${environment.conda}`:'此机器尚未检测到 Conda，可先安装 Miniconda。'}</p>:<label>Python 环境<select value={python} disabled={busy||running} onChange={e=>{setPython(e.target.value);setPlan(undefined);}}><option value="">选择已检测的解释器</option>{interpreters.map(path=><option key={path} value={path}>{path}</option>)}</select></label>}
      </>}
      {app.id==='python'&&<><label>环境名称<input value={environmentName} disabled={busy||running} onChange={e=>{setEnvironmentName(e.target.value);setPlan(undefined);}}/></label><label>Python 版本<select value={version} disabled={busy||running} onChange={e=>{setVersion(e.target.value as typeof version);setPlan(undefined);}}>{['3.11','3.12','3.13','3.14'].map(v=><option key={v}>{v}</option>)}</select></label></>}
      <button disabled={busy||running||(app.id==='python'&&!environment?.conda)||(['jupyter','jedi'].includes(app.id)&&!python)} onClick={()=>void run(async()=>{setPlan(undefined);setPlan(await window.cshell.applicationPlan(sessionId,{app:app.id,python:python||undefined,conda:environment?.conda||undefined,name:environmentName,version}));})}>{busy?'正在检查…':'检查安装条件'}</button>
      {plan&&<div className="development-plan"><strong>{plan.label} · {name}</strong><p>安装使用当前 SSH 用户权限；不会自动提权。</p><details><summary>查看安装操作</summary><pre>{plan.command}</pre></details><button className="primary" disabled={busy||running} onClick={()=>void run(async()=>{const next=await window.cshell.applicationInstall(plan.id);setJobs(old=>[...old.filter(j=>j.id!==next.id),next]);setPlan(undefined);})}><Download size={16}/>确认安装</button></div>}
    </div>:<div className="development-grid">{applications.map(a=><button key={a.id} disabled={busy} onClick={()=>choose(a.id)}><span className="development-logo"><Package size={24}/></span><strong>{a.name}</strong><small>{a.description}</small><span className="development-state"><Download size={14}/>查看安装条件</span></button>)}</div>}
    {jobs.map(job=><details key={job.id} open={job.state==='running'}><summary>{job.label} · {{running:'安装中',succeeded:'已完成',failed:'失败',cancelled:'已取消'}[job.state]}</summary><pre>{job.output}</pre>{job.state==='running'&&<button onClick={()=>void run(()=>window.cshell.cancelJob(job.id))}>停止安装</button>}</details>)}
  </section>;
}
