import {useState} from 'react';
import {ArrowRight,Plus,Trash2,RefreshCw,Pencil,Monitor,Terminal,Server} from 'lucide-react';
import {ErrorNotice} from './ErrorNotice';
import {cleanDisplayError} from '../error-display';
import {identityKey,validateIdentityRules,type IdentityEndpoint,type IdentityNetworkCommand,type IdentityNetworkStatus} from '../../shared/identity-network';

const kindName=(endpoint:IdentityEndpoint)=>endpoint.kind==='local'?'本机':endpoint.kind==='ssh'?'SSH':'CAgent';
const EndpointIcon=({endpoint}:{endpoint:IdentityEndpoint})=>endpoint.kind==='local'?<Monitor size={15}/>:endpoint.kind==='ssh'?<Terminal size={15}/>:<Server size={15}/>;
export function MachineNetworkRules(){
  const [state,setState]=useState<IdentityNetworkStatus>(),[source,setSource]=useState(''),[target,setTarget]=useState('');
  const [originalSource,setOriginalSource]=useState('');
  const [editing,setEditing]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const run=async(command:IdentityNetworkCommand={action:'list'})=>{
    setBusy(true);setError('');setNotice('');
    try{
      const result=await window.cshell.identityNetwork(command);setState(result);
      if(command.action!=='list'){setEditing(false);setSource('');setTarget('');setNotice(command.action==='remove'?(result.pendingRemovals?.some(item=>identityKey(item.source)===identityKey(command.source))?'撤销已排队，等待来源机器恢复':'已撤销此规则'):'已保存，状态以实际连接结果为准');}
    }catch(e){setError(String(e));}finally{setBusy(false);}
  };
  const endpoints=state?.endpoints??[];
  const find=(key:string)=>endpoints.find(item=>identityKey(item.endpoint)===key);
  const label=(endpoint:IdentityEndpoint)=>find(identityKey(endpoint))?.name??'已移除的机器';
  const selectedSource=find(source),selectedTarget=find(target);
  let validation='';
  if(selectedSource&&selectedTarget){try{validateIdentityRules([...(state?.rules??[]).filter(r=>identityKey(r.source)!==source).map(({source,target})=>({source,target})),{source:selectedSource.endpoint,target:selectedTarget.endpoint}]);}catch(e){validation=e instanceof Error?e.message:String(e);}}
  const save=()=>{if(selectedSource&&selectedTarget&&!validation)void run({action:'save',rule:{source:selectedSource.endpoint,target:selectedTarget.endpoint}});};
  return <details className="network-rule-section identity-network" onToggle={e=>{if(e.currentTarget.open&&!state&&!busy)void run();}}>
    <summary>机器网络出口</summary>
    <p>按来源设置出口。SSH 规则用于之后打开的终端；只代理遵守代理设置的应用，不改变已运行软件的网络。</p>
    {error&&<ErrorNotice title="网络出口未完成" error={error}/>}
    <div className="network-rule-heading"><span>{state?`${state.rules.length} 条规则`:'来源 → 出口'}</span><div className="identity-rule-actions">
      <button type="button" className="icon" title="刷新规则状态" aria-label="刷新规则状态" disabled={busy} onClick={()=>void run()}><RefreshCw size={15}/></button>
      <button type="button" className="identity-rule-add" disabled={busy||!state} onClick={()=>{setSource('');setTarget('');setOriginalSource('');setEditing(true);}}><Plus size={14}/>添加规则</button>
    </div></div>
    {!state&&!error&&<p role="status">正在读取机器…</p>}
    {state&&<>
      <div className="identity-rule-list" aria-label="网络出口规则">
        {state.rules.length===0&&!editing&&<div className="identity-rule-empty">还没有规则，添加来源和出口即可。</div>}
        {state.rules.map(rule=><div className="identity-rule-row" key={identityKey(rule.source)}>
          <div className="identity-rule-endpoint"><EndpointIcon endpoint={rule.source}/><span><strong>{label(rule.source)}</strong><small>{kindName(rule.source)}</small></span></div>
          <ArrowRight size={14} aria-hidden="true"/>
          <div className="identity-rule-endpoint"><EndpointIcon endpoint={rule.target}/><span><strong>{label(rule.target)}</strong><small>{kindName(rule.target)}</small></span></div>
          <div className="identity-rule-status" data-state={rule.state}><span>{rule.state==='active'?'已生效':rule.state==='pending'?'等待连接':'未生效'}</span>{rule.error&&<small title={cleanDisplayError(rule.error)}>{cleanDisplayError(rule.error)}</small>}{rule.proxy&&<code title="来源机器上的应用代理地址">{rule.proxy}</code>}</div>
          <div className="identity-rule-actions"><button type="button" className="icon" title="编辑规则" aria-label={`编辑 ${label(rule.source)} 的出口`} disabled={busy} onClick={()=>{setSource(identityKey(rule.source));setTarget(identityKey(rule.target));setOriginalSource(identityKey(rule.source));setEditing(true);}}><Pencil size={14}/></button><button type="button" className="icon" title="撤销规则" aria-label={`撤销 ${label(rule.source)} 的出口`} disabled={busy} onClick={()=>void run({action:'remove',source:rule.source})}><Trash2 size={14}/></button></div>
        </div>)}
      </div>
      {state.pendingRemovals?.map(item=><div key={identityKey(item.source)} className="identity-rule-warning" role="status"><strong>{label(item.source)}</strong> · 等待机器恢复后撤销{item.error&&<small>：{cleanDisplayError(item.error)}</small>}</div>)}
      {editing&&<fieldset className="identity-rule-editor" disabled={busy}><legend>设置出口</legend><div className="network-rule-create">
        <label>来源<select aria-label="代理规则来源" disabled={!!originalSource} value={source} onChange={e=>{setSource(e.target.value);if(e.target.value===target)setTarget('');}}><option value="">选择机器</option>{endpoints.map(item=><option key={identityKey(item.endpoint)} value={identityKey(item.endpoint)}>{item.name} · {kindName(item.endpoint)}{item.available?'':' · 未连接'}</option>)}</select></label>
        <ArrowRight size={15} aria-hidden="true"/>
        <label>出口<select aria-label="代理规则出口" value={target} onChange={e=>setTarget(e.target.value)}><option value="">选择机器</option>{endpoints.filter(item=>identityKey(item.endpoint)!==source).map(item=><option key={identityKey(item.endpoint)} value={identityKey(item.endpoint)}>{item.name} · {kindName(item.endpoint)}{item.available?'':' · 未连接'}</option>)}</select></label>
      </div>{validation&&<p className="identity-rule-warning" role="status">{validation}</p>}{[selectedSource,selectedTarget].filter(item=>item&&!item.available).map(item=><p key={identityKey(item!.endpoint)} className="identity-rule-warning">{item!.name}：{item!.reason??'当前未连接，保存后以实际状态为准'}</p>)}
      <div className="identity-rule-editor-actions"><button type="button" onClick={()=>setEditing(false)}>取消</button><button type="button" className="primary" disabled={!selectedSource||!selectedTarget||!!validation} onClick={save}>{busy?'应用中…':'保存规则'}</button></div></fieldset>}
      {notice&&<p role="status">{notice}</p>}
    </>}
  </details>;
}
