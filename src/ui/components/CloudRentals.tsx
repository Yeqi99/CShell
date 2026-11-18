import {CircleCheck,Server} from 'lucide-react';
import {useEffect,useRef,useState} from 'react';
import type {RentalCatalog} from '../../shared/cloud-sync';

type Plan = RentalCatalog['plans'][number];
function configurations(plans: Plan[]) {
  const groups = new Map<string, {name:string; rates:Plan[]}>();
  for (const plan of plans) {
    const name = plan.name.replace(/\s*(?:[·・—-]\s*)?(?:日租|月租|日付|月付)$/, '').trim() || plan.name;
    const key = JSON.stringify([name, plan.system, plan.cpu, plan.memory, plan.disk, plan.portCount, plan.dedicatedIp]);
    const group = groups.get(key) ?? {name, rates:[]};
    group.rates.push(plan);
    groups.set(key, group);
  }
  return [...groups.values()];
}
function period(days:number) { return days === 30 ? '月付' : days === 1 ? '日付' : days+' 天'; }
const labels:Record<string,string>={queued:'等待分配',installing:'安装中',ready:'可连接',resuming:'恢复中',released:'已释放',expired:'已到期',failed:'开通失败'};
export function CloudRentals({member,storefront=false}:{member:boolean;storefront?:boolean}){
  const [data,setData]=useState<RentalCatalog>();
  const [error,setError]=useState('');
  const [chosen,setChosen]=useState('');
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const pending=useRef<{key:string;request:string}|undefined>(undefined);
  const mounted=useRef(true);
  const refresh=async()=>{
    try{
      const result=await window.cshell.cloudRentals({action:'list'});
      if(mounted.current){setData(result);setError('');}
    }catch(e){if(mounted.current)setError(String(e));}
  };
  useEffect(()=>{mounted.current=true;void refresh();return()=>{mounted.current=false;};},[]);
  const waiting=data?.machines.some(m=>(['queued','installing','resuming'].includes(m.state)||m.updating));
  useEffect(()=>{if(waiting){const timer=setInterval(()=>void refresh(),10000);return()=>clearInterval(timer);}},[waiting]);
  async function order(plan:string,included:boolean){
    const key=plan+':'+included;
    if(pending.current?.key!==key)pending.current={key,request:crypto.randomUUID()};
    setBusy(true);setError('');
    try{
      setData(await window.cshell.cloudRentals({action:'order',plan,included,points:data?.plans.find(p=>p.id===plan)?.points??0,days:data?.plans.find(p=>p.id===plan)?.days??1,request:pending.current.request}));
      pending.current=undefined;setNotice('已提交开通请求');
    }catch(e){setError(String(e));}finally{setBusy(false);}
  }
  const [change,setChange]=useState<{id:string;kind:'expand'|'cpu'|'memory'|'port'|'renew';request:string;amount:number}|null>(null);
  async function adjust(id:string,kind:'expand'|'cpu'|'memory'|'port'|'renew',confirmed=false){
    setBusy(true);setError('');
    const request=confirmed&&change?change.request:crypto.randomUUID();
    try{
      const result=await window.cshell.cloudRentals({action:'change',id,kind,request,units:1,quote:!confirmed,maxPoints:confirmed?change?.amount:undefined});
      setData(result);
      if(confirmed){setChange(null);setNotice(kind==='renew'?'续费成功':'已提交资源扩容');}
      else if(result.quote)setChange({id,kind,request,amount:result.quote.points});
    }catch(e){setError(String(e));}finally{setBusy(false);}
  }
  async function connect(id:string){
    setBusy(true);
    try{setData(await window.cshell.cloudRentals({action:'connect',id}));setError('');setNotice('已接管，可在左侧服务器列表打开机器');}
    catch(e){setError(String(e));}finally{setBusy(false);}
  }
  function network(plan:RentalCatalog['plans'][number]){
    if(typeof plan.dedicatedIp!=='boolean')return '公网配置待服务商确认';
    return plan.dedicatedIp?'独立公网 IP':('共享公网 IP · '+plan.portCount+' 个业务映射端口 · cagent 端口另计');
  }
  async function requestPorts(id:string){
    setBusy(true);setError('');
    try{setData(await window.cshell.cloudRentals({action:'ports',id}));setNotice('已核对服务商分配的端口');}
    catch(e){setError(String(e));}finally{setBusy(false);}
  }
  function portList(m:RentalCatalog['machines'][number]){
    if(m.state!=='ready'||m.portCount===undefined)return null;
    const ports=m.ports??[];
    return <details key={m.id} className="rental-port-list"><summary>{storefront && m.name+' · '+m.id.slice(0,8)+' · '}端口映射 {ports.length}/{m.portCount}</summary>
      <p>在实例内监听对应端口，即可使用列表中的公网地址访问服务。</p>
      {ports.map(p=><code key={p.host+':'+p.port}>{p.host}:{p.port}</code>)}
      <button disabled={busy} onClick={()=>void requestPorts(m.id)}>{ports.length<m.portCount?'申请补齐业务端口':'核对端口分配'}</button>
    </details>;
  }
  const groups = configurations(data?.plans ?? []);
  const defaultRate = (rates:Plan[]) => rates.find(p=>p.days===30) ?? rates[0];
  const active = groups.find(g=>g.rates.some(p=>p.id===chosen)) ?? groups[0];
  const selected = active && (active.rates.find(p=>p.id===chosen) ?? defaultRate(active.rates));
  function choose(id:string) { setChosen(id); setNotice(''); }
  const options = <div className="rental-plans">{groups.map(group=>{
    const checked = active===group;
    const plan = checked ? selected! : defaultRate(group.rates);
    return <div key={group.rates[0].id} className="rental-option">
      <label><input type="radio" name="rental-plan" checked={checked} disabled={busy} onChange={()=>choose(plan.id)}/>
        <span><strong>{group.name}</strong><small>{plan.system} · {plan.cpu/100} 核 · {plan.memory/1024} GiB 内存 · {plan.disk/1024} GiB 磁盘</small><small>{network(plan)}</small></span>
        <span className="rental-price">{plan.points.toLocaleString()} 点<small>{period(plan.days)}</small></span>
      </label>
      {checked && group.rates.length>1 && <div className="rental-periods" role="group" aria-label="付款周期">{group.rates.map(rate=><button type="button" key={rate.id} aria-pressed={selected?.id===rate.id} disabled={busy} onClick={()=>choose(rate.id)}>{period(rate.days)} · {rate.points.toLocaleString()} 点</button>)}</div>}
    </div>;
  })}</div>;
  if(storefront){
    return <section className="rental-store">
      <header><h2>可选配置</h2><span>可用点数 <strong>{data?.balance.toLocaleString() ?? '—'}</strong></span></header>
      {!data && !error && <p role="status">正在读取套餐…</p>}
      {data && !selected && <p>暂无可租套餐</p>}
      {options}
      {selected && data && <footer><span>{data.balance<selected.points?'点数不足，还差 '+(selected.points-data.balance).toLocaleString()+' 点':'租期 '+selected.days+' 天'}</span>
        <button className="primary" disabled={busy||data.balance<selected.points} onClick={()=>void order(selected.id,false)}>{busy?'正在提交…':'支付 '+selected.points.toLocaleString()+' 点并开机'}</button></footer>}
      {data?.machines.map(portList)}
      {notice && <p role="status">{notice}</p>}
      {data?.machines.filter(m=>['queued','installing','resuming'].includes(m.state)).map(m=><p key={m.id} role="status">{m.name} · {labels[m.state]}</p>)}
      {error && <p role="alert">{error} <button onClick={()=>void refresh()}>重试</button></p>}
      {data?.machines.some(m=>m.state==='ready') && <p>已就绪的机器可从左侧“云端主机”打开。</p>}
    </section>;
  }
  const isCurrentMemberMachine=(m:RentalCatalog['machines'][number])=>m.included && !['failed','expired','released'].includes(m.state);
  const claimed=data?.machines.find(isCurrentMemberMachine);
  const machines=claimed ? [claimed,...data!.machines.filter(m=>m.id!==claimed.id)] : data?.machines;
  const memberRate=active?.rates.find(p=>p.included);
  const plans=selected && data && <>{options}
    {!data.memberPlans?.length && memberRate && member && !claimed && <button disabled={busy} onClick={()=>void order(memberRate.id,true)}>领取会员机器 · 随会员到期</button>}
    <button disabled={busy||data.balance<selected.points} onClick={()=>void order(selected.id,false)}>支付 {selected.points.toLocaleString()} 点租用 {selected.days} 天</button>
  </>;
  return <details className="account-section account-rentals">
    <summary>云机器租赁{claimed && <span className="rental-claimed"><CircleCheck size={14}/>会员机已领取</span>}</summary>
    {member && !claimed && data?.memberPlans?.map(p=><button key={p.id} disabled={busy} onClick={()=>void order(p.id,true)}>领取 {p.name} · 随会员到期</button>)}
    {machines?.map(m=><article className={isCurrentMemberMachine(m)?'rental-owned':''} key={m.id}>
      <header className="rental-machine-heading"><Server size={17}/><strong>{m.included?'会员机器':'点数租用'} · {m.name}</strong><span>{labels[m.state]??(m.state==='paused'?'已暂停':m.state)}</span></header>
      <p>{m.disk/1024} GiB 磁盘{m.updating?'（扩容中）':''}{m.expires?' · 到期 '+new Date(m.expires*1000).toLocaleDateString():''} · {m.id.slice(0,8)}</p>
      {m.state==='ready' && <><button disabled={busy} onClick={()=>void connect(m.id)}>加入服务器列表</button>
        {(['cpu','memory'] as const).map(k=><button key={k} disabled={busy||m.updating} onClick={()=>void adjust(m.id,k)}>{k==='cpu'?'增加 1 核':'增加 1 GiB 内存'}</button>)}
        <button disabled={busy} onClick={()=>void adjust(m.id,'port')}>增加 1 个端口 · 200 点/月</button><button disabled={busy||m.updating} onClick={()=>void adjust(m.id,'expand')}>扩容 10 GiB</button></>}
      {['ready','expired'].includes(m.state)&&<button disabled={busy} onClick={()=>void adjust(m.id,'renew')}>续费</button>}
      {change?.id===m.id && <p>本次{({expand:'扩容 10 GiB 磁盘',cpu:'增加 1 核',memory:'增加 1 GiB 内存',port:'增加 1 个端口',renew:'按现有容量续费'})[change.kind]}需 {change.amount} 点 <button disabled={busy} onClick={()=>void adjust(m.id,change.kind,true)}>确认</button><button disabled={busy} onClick={()=>setChange(null)}>取消</button></p>}
      {portList(m)}
    </article>)}
    {data && <div className="rental-account-balance">可用点数 {data.balance.toLocaleString()} <button onClick={()=>void refresh()} disabled={busy}>刷新</button></div>}
    {claimed && plans ? <details className="rental-additional"><summary>用点数租用额外机器</summary>{plans}</details> : plans}
    {data&&!data.plans.length&&<p>暂无可租套餐</p>}
    {error&&<p role="alert">{error} <button onClick={()=>void refresh()}>重试</button></p>}{notice&&<p role="status">{notice}</p>}
  </details>;
}
