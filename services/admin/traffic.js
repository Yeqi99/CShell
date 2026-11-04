export function mountTraffic(root){
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const api=async (body,path='traffic')=>{const r=await fetch('/admin-api/v1/admin/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const v=await r.json();if(!r.ok)throw Error(v.error||'服务暂不可用');return v;};
 const month=new Date().toISOString().slice(0,7);
 root.innerHTML=`<div class="page-head"><div><h1>流量与成本</h1><p>UTC 月结算 · 中继与 MCP 分开计量 · 未配置额度保持原权益</p></div></div><p role="status" id="traffic-status"></p><section class="card" id="traffic-data"></section><section class="card"><h2>额度与费率</h2><form id="traffic-change" class="feedback-detail"><label class="field">操作<select name="action"><option value="limit">月额度（留空为不限）</option><option value="grant">本月扩容</option><option value="rate">成本费率</option><option value="reconcile">异常预留对账</option></select></label><label class="field">账号 ID<input name="account"></label><label class="field">类别<select name="category"><option value="relay">中继</option><option value="mcp">MCP</option></select></label><label class="field">UTC 月份<input type="month" name="period" value="${month}" required></label><label class="field">额度 / 扩容量（GiB）<input type="number" min="0" step="0.001" name="gib"></label><details><summary>成本费率</summary><label class="field">入站 / GiB<input name="ingress" type="number" min="0" step="0.000001"></label><label class="field">出站 / GiB<input name="egress" type="number" min="0" step="0.000001"></label><label class="field">币种<select name="currency"><option>CNY</option><option>USD</option></select></label></details><details><summary>异常预留对账（需核实实际传输记录）</summary><label class="field">预留编号<input name="id"></label><label class="field">实际入站字节<input name="ingressBytes" type="number" min="0"></label><label class="field">实际出站字节<input name="egressBytes" type="number" min="0"></label><p>进程中断后保留预算，避免重复消费。仅在核实日志后结算；不将未知流量当作零。</p></details><label class="field">变更原因<textarea name="reason" required minlength="2" maxlength="300"></textarea></label><button class="btn primary">保存配置</button></form></section>`;
 const status=root.querySelector('#traffic-status'),data=root.querySelector('#traffic-data');
 async function load(){const v=await api();data.innerHTML=`<h2>实际用量</h2><div class="table-wrap"><table><thead><tr><th>账号 / UTC 月</th><th>类别</th><th>入站</th><th>出站</th><th>估算成本</th></tr></thead><tbody>${v.usage.map(r=>`<tr><td>${esc(r.email)}<br>${esc(r.period)}</td><td>${esc(r.category)}</td><td>${(r.ingressBytes/1024**3).toFixed(4)} GiB</td><td>${(r.egressBytes/1024**3).toFixed(4)} GiB</td><td>${r.cost===null?'尚未配置费率':esc(r.cost)+' '+esc(r.currency)}</td></tr>`).join('')}</tbody></table></div><h2>待结算预留</h2>${v.reservations.map(r=>`<p><code>${esc(r.id)}</code> · ${esc(r.account)} · ${esc(r.category)} · ${(r.budget/1024**2).toFixed(2)} MiB</p>`).join('')||'<p>没有待结算预留</p>'}`;}
 root.insertAdjacentHTML('beforeend',`<section class="card"><h2>同步容量扩容</h2><p class="muted">增加账号同步容量，保留原权益；当前服务总容量上限为 256 MiB。到期时间按本机时区输入。</p><form id="storage-change" class="feedback-detail"><label class="field">同步扩容账号 ID<input name="account" required></label><label class="field">增加容量（MiB）<input name="mib" type="number" min="1" max="256" step="1" required></label><label class="field">到期时间<input name="expiry" type="datetime-local" required></label><label class="field">同步扩容原因<textarea name="reason" minlength="2" maxlength="300" required></textarea></label><button class="btn primary">保存同步扩容</button><p role="status" class="grant-status"></p></form></section>`);
 function bind(form,path,makePayload){
  const key='cshell-admin-'+path+'-draft-v1';let saved={};
  try{saved=JSON.parse(sessionStorage.getItem(key)||'{}');}catch{}
  for(const [name,value] of Object.entries(saved.fields||{})){const input=form.elements.namedItem(name);if(input)input.value=String(value);}
  const persist=()=>{saved.fields=Object.fromEntries(new FormData(form));sessionStorage.setItem(key,JSON.stringify(saved));};
  form.addEventListener('input',()=>{try{persist();}catch{}});
  form.addEventListener('change',()=>{try{persist();}catch{}});
  form.onsubmit=async e=>{
   e.preventDefault();const button=form.querySelector('button'),message=form.querySelector('.grant-status')||status;button.disabled=true;
   try{
    const payload=makePayload(Object.fromEntries(new FormData(form)));
    if(path==='storage-grant'||payload.action==='grant'){
     const signature=JSON.stringify(payload);
     if(saved.signature!==signature||!saved.id){saved.signature=signature;saved.id=crypto.randomUUID();}
     payload.id=saved.id;
    }
    // Persist before sending so response loss/remount cannot create another grant.
    persist();
    const result=await api(payload,path);
    message.textContent=result.replayed?'此请求已处理，未重复扩容':'已保存并记录审计';
    try{await load();}catch{message.textContent+='；列表刷新失败，可稍后重试';}
   }catch(error){message.textContent=error.message||'提交未完成，草稿已保留';}
   finally{button.disabled=false;}
  };
 }
 bind(root.querySelector('#traffic-change'),'traffic',v=>{
  const payload={action:v.action,account:v.account.trim(),category:v.category,period:v.period,reason:v.reason.trim()};
  if(v.action==='limit'||v.action==='grant'){
   payload.bytes=v.gib===''?null:Math.floor(Number(v.gib)*1024**3);
   if((v.action==='grant'&&!(payload.bytes>0))||(payload.bytes!==null&&(!Number.isSafeInteger(payload.bytes)||payload.bytes<0)))throw Error('请输入有效的容量');
  }else if(v.action==='rate'){Object.assign(payload,{ingress:v.ingress,egress:v.egress,currency:v.currency});}
  else if(v.action==='reconcile'){Object.assign(payload,{id:v.id,ingressBytes:Number(v.ingressBytes),egressBytes:Number(v.egressBytes)});}
  return payload;
 });
 bind(root.querySelector('#storage-change'),'storage-grant',v=>{
  const bytes=Number(v.mib)*1024**2,expiresAt=new Date(v.expiry).getTime()/1000;
  if(!Number.isSafeInteger(bytes)||bytes<=0||bytes>256*1024**2||!Number.isFinite(expiresAt)||expiresAt<=Date.now()/1000)throw Error('请输入有效容量和未来的到期时间');
  return {account:v.account.trim(),bytes,expiresAt,reason:v.reason.trim()};
 });
 void load().catch(e=>status.textContent=e.message);
}
