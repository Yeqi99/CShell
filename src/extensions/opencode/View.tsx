import {useEffect,useState} from 'react';
import './view.css';
const call=(action:string,input?:unknown)=>window.cshell.aiExtensionCall('cshell.opencode',action,input) as Promise<any>;
export function OpenCodeView(){
 const [key,setKey]=useState(''),[workspace,setWorkspace]=useState(''),[hasKey,setHasKey]=useState(false),[tier,setTier]=useState<'go'|'zen'>('go'),[models,setModels]=useState<{id:string;available:boolean}[]>([]),[model,setModel]=useState(''),[query,setQuery]=useState(''),[usage,setUsage]=useState<any>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const run=async(fn:()=>Promise<void>)=>{setBusy(true);setMessage('');try{await fn();}catch(e){setMessage((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /,''));}finally{setBusy(false);}};
 useEffect(()=>{let active=true;void call('status').then(s=>{if(active){setHasKey(s.hasKey);setWorkspace(s.workspace);}}).catch(e=>{if(active)setMessage(e.message);});return()=>{active=false;};},[]);
 useEffect(()=>{let active=true;setModels([]);setModel('');void call('models',{tier}).then(m=>{if(active)setModels(m);}).catch(e=>{if(active)setMessage(e.message);});return()=>{active=false;};},[tier]);
 return <section className="opencode-extension">
  <div className="opencode-heading"><div><h2>OpenCode</h2><p>连接账号，选择模型，作为智能体基座使用。</p></div><button onClick={()=>void run(async()=>{await call('open',{page:'keys'});})}>管理 API Key</button></div>
  <form onSubmit={e=>{e.preventDefault();void run(async()=>{const s=await call('save',{...(key?{key}:{}),workspace});setKey('');setHasKey(s.hasKey);setWorkspace(s.workspace);setMessage('接入配置已保存');});}}>
   <label>工作区地址<input value={workspace} onChange={e=>setWorkspace(e.target.value)} placeholder="粘贴 OpenCode 控制台当前页面网址"/></label>
   <label>API Key<input type="password" autoComplete="new-password" value={key} onChange={e=>setKey(e.target.value)} placeholder={hasKey?'已保存，留空保留':'从控制台 Keys 页面复制'}/></label>
   <p>控制台进入 Keys 创建 API Key；部分新版界面先创建 Service Account，再添加 API Key。保存工作区后，“管理 API Key”可直达对应工作区。</p>
   <button disabled={busy||(!key&&!hasKey)} className="primary">保存接入</button>
  </form>
  <div className="opencode-models"><div className="opencode-row"><label>使用方式<select value={tier} onChange={e=>setTier(e.target.value as 'go'|'zen')}><option value="go">Go 套餐</option><option value="zen">按量计费</option></select></label><button disabled={busy} onClick={()=>void run(async()=>setModels(await call('models',{tier,refresh:true})))}>刷新模型</button></div>
   <p>{tier==='go'?'仅显示 Go 目录。是否有套餐及剩余额度以官方账号为准。':'使用按量计费余额，与 Go 套餐分开。'}</p>
   <label>查找模型<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="输入模型名称"/></label>
   <label>模型<select aria-label="模型" size={7} value={model} onChange={e=>setModel(e.target.value)}>{models.filter(m=>m.id.toLowerCase().includes(query.toLowerCase())).map(m=><option key={m.id} value={m.id} disabled={!m.available}>{m.id}{m.available?'':' · 协议待适配'}</option>)}</select></label>
   <button disabled={busy||!model||!hasKey} className="primary" onClick={()=>void run(async()=>{await call('add',{tier,model,name:`OpenCode ${tier==='go'?'Go':'按量'} · ${model}`});setMessage('已添加到智能体基座，可在智能体中选择');})}>添加为智能体基座</button>
  </div>
  <div className="opencode-usage"><div className="opencode-row"><h3>Go 用量</h3><button disabled={busy||!hasKey} onClick={()=>void run(async()=>setUsage(await call('usage')))}>查询额度</button><button onClick={()=>void run(async()=>{await call('open',{page:'go'});})}>打开官方用量页</button></div>
   {usage?<><p>{usage.message}</p>{usage.windows.map((w:any)=><div key={w.label} className="opencode-window"><span>{w.label}</span><progress max={100} value={Math.min(100,w.usedPercent)}/><span>已用 {w.usedPercent.toFixed(1)}%</span>{w.resetAt&&<small>重置：{new Date(w.resetAt).toLocaleString()}</small>}</div>)}<small>查询于 {new Date(usage.checkedAt).toLocaleString()}{usage.useBalance===true?' · 官方已开启超额使用余额':''}</small></>:<p>按需读取官方额度，不读取浏览器 Cookie，也不修改计费设置。</p>}
  </div><p role="status">{busy?'处理中…':message}</p>
 </section>;
}
