import {useEffect,useState} from 'react';
import './membership-market.css';
type Offer=Awaited<ReturnType<typeof window.cshell.cloudMembershipMarket>>['plans'][number];
export function MembershipMarket({email,refresh}:{email:string;refresh:()=>void}){
 const [open,show]=useState(false),[plans,setPlans]=useState<Offer[]>([]),[selected,select]=useState<Offer>(),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 useEffect(()=>{let valid=true;if(open)window.cshell.cloudMembershipMarket(email).then(r=>{if(valid)setPlans(r.plans);}).catch(e=>{if(valid)setMessage(String(e));});return ()=>{valid=false;};},[open,email]);
 async function purchase(p:Offer){
   if(p.days===null||p.price===null||busy)return;
   const key=JSON.stringify(['membership-order',email,p.plan,p.price,p.days]);
   const request=localStorage.getItem(key)||crypto.randomUUID();localStorage.setItem(key,request);setBusy(true);
   try{const r=await window.cshell.cloudBuyPlan(email,{plan:p.plan,days:p.days,price:p.price,request});
     localStorage.removeItem(key);select(undefined);setMessage(p.plan+' 有效至 '+new Date(r.expires*1000).toLocaleDateString());refresh();
   }catch(e){setMessage(String(e));}finally{setBusy(false);}
 }
 return <details className="membership-market" onToggle={e=>show(e.currentTarget.open)}><summary>会员套餐与权益</summary>
 {open&&plans.map(p=><article key={p.plan}><header data-tier={p.plan}><strong>{p.plan}</strong></header>
 <p>周额度 {p.relativeQuota} × Pro · 云同步 {p.storageMiB} MiB</p><p>{p.machine?'会员机 · '+p.machine:'无附赠机器'}</p>
 {p.price===null?<span>兑换开通</span>:<button disabled={busy} onClick={()=>selected===p?void purchase(p):select(p)}>{selected===p?'确认支付 ':''}{p.price.toLocaleString()} 点 / {p.days} 天</button>}
 {selected===p&&<button disabled={busy} onClick={()=>select(undefined)}>取消</button>}</article>)}{message&&<p role="status">{message}</p>}</details>;
}
