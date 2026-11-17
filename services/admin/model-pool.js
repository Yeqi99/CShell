export function mountPool(root){
 const api=async body=>{const r=await fetch('/admin-api/v1/admin/model-pool',{method:body?'POST':'GET',cache:'no-store',...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});const v=await r.json();if(!r.ok)throw Error(v.error||'服务不可用');return v;};
 const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const names={aiopen:'明杰 AIOPEN',kimi:'Kimi 直连',qwen:'通义千问',mimo:'小米 MiMo',deepseek:'DeepSeek','qwen-plan':'百炼 Token Plan','mimo-plan':'MiMo Token Plan','opencode-go':'OpenCode Go'};
 function drawInventory(inv){
  const panel=view.querySelector('[data-inventory]');if(!panel||!inv)return;
  const fmt=v=>Number(v).toLocaleString('zh-CN',{maximumFractionDigits:8});
  const yuan=v=>v==null?'待核对':'¥'+fmt(v);
  const current=data.pools.find(p=>p.provider===provider);
  const amount=inv.byProvider?.[provider];
  const monthly=inv.subscriptionYuan?.[provider];
  const units=(inv.units||[]).filter(u=>u.provider===provider && u.unit!=='CNY');
  const wallet=amount==null?(current?.keys.length?'暂无可核对的余额':'未接入账号'):yuan(amount);
  panel.innerHTML='<h2>'+esc(names[provider]??provider)+' · 供应商库存</h2>'+
    '<p>剩余价值 <b>'+wallet+'</b>'+(monthly==null?'':' · 月套餐金额 '+yuan(monthly))+'</p>'+
    units.map(u=>'<p>剩余 '+fmt(u.remaining)+(u.total==null?'':' / '+fmt(u.total))+' '+esc(u.unit)+'</p>').join('');

 }
 let provider,data; const cache=new Map(),supported=id=>Object.hasOwn(names,id);
 root.innerHTML='<div class="page-head"><div><h1>会员模型号池</h1><p>周一 00:00（北京时间）重置 · 每位 Pro 会员每周共享一份模型额度</p></div><button class="btn" data-refresh>刷新用量</button></div><p role="status"></p><div data-view></div>';
 const status=root.querySelector('[role=status]'),view=root.querySelector('[data-view]');
 const field=(label,input)=>'<label class="field">'+label+input+'</label>';
 function render(){const p=data.pools.find(x=>x.provider===provider);
 view.innerHTML='<div class="actions">'+data.pools.map(p=>[p.provider,names[p.provider]??p.provider]).map(([id,n])=>'<button class="btn '+(provider===id?'primary':'')+'" data-provider="'+id+'">'+n+'</button>').join(' ')+'</div>'+
 '<section class="card"><h2>'+names[provider]+' · 运营库存</h2><p>本周号池预算 <b>'+p.capacity+'</b> 点　有效会员 <b>'+data.members+'</b> 人</p><p>默认 Pro 会员所有模型合计 <b>'+data.weeklyYuan+'</b> 元成本 / 周。</p><form data-mode="limit" class="field-row">'+field('每点 Token 数（0 按次）','<input name="tokens" type="number" min="0" max="99999999" step="1" required value="'+(p.tokensPerPoint??0)+'">')+'<button class="btn">保存计量设置</button></form></section>'+
 '<section class="card"><h2>本周调用</h2><p>成功 '+(p.calls.ok||0)+'　拒绝（不扣点） '+(p.calls.rejected||0)+'　处理中 '+(p.calls.pending||0)+'　待核对 '+(p.calls.unknown||0)+'</p></section>'+
 '<section class="card"><h2>供应商账号</h2><p>容量为 CShell 运营预算。按所选计量方式和模型倍率结算，与供应商余额分开。</p><div class="table-wrap"><table><thead><tr><th>账号</th><th>状态</th><th>已占用 / 周容量</th><th>供应商额度</th><th>操作</th></tr></thead><tbody>'+p.keys.map((k,i)=>'<tr><td>'+esc(k.label)+'</td><td>'+(!k.enabled?'停用':k.cooldown>Date.now()/1000?'冷却中':'启用')+'</td><td>'+k.used+' / '+k.weekly+'</td><td data-quota>'+ (supported(provider)?'待查询':provider==='qwen-plan'?'请通过百炼 CLI 核对':'未接入查询')+'</td><td><button class="btn" data-edit="'+i+'">编辑</button> '+(supported(provider)?'<button class="btn" data-balance="'+i+'">查官方额度</button>':'')+'</td></tr>').join('')+'</tbody></table></div><details data-account><summary>添加或编辑账号</summary><form data-mode="key" class="feedback-detail"><input name="id" type="hidden">'+field('账号备注','<input name="label" maxlength="80" required>')+field('API Key（编辑时留空保留）','<input name="key" type="password" autocomplete="new-password">')+field('供应商余额账户标识（共用钱包填相同值）','<input name="wallet" maxlength="80">')+field('人民币 / 供应商单位（美元或 Credits）','<input name="unitYuan" type="number" step="any" min="0.000000000001">')+field('月套餐金额（元）','<input name="monthlyYuan" type="number" step=".01" min=".01">')+field('每周预算（点）','<input name="capacity" type="number" step=".01" min="0" required>')+'<label><input type="checkbox" name="enabled" checked> 参与分配</label><button class="btn primary">保存账号</button></form></details></section>'+
 '<section class="card"><h2>可选模型与倍率</h2><p>'+p.models.map(m=>esc(m.name)+(m.costLabel?' · '+esc(m.costLabel):'')+(m.speed?' · '+({fast:'速度快',normal:'速度适中',slow:'速度较慢',verySlow:'速度慢'}[m.speed.level])+'（首字 '+m.speed.first+' 秒，'+m.speed.cps+' 字/秒，'+m.speed.samples+' 次实测，'+new Date(m.speed.measured*1000).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai'})+'）':' · 速度待测')+(m.costPerMillion?' · 输入 / 缓存 / 输出 '+m.costPerMillion.join(' / ')+' 元/百万 Token':' ×'+m.multiplier)+(m.enabled?'':'（停用）')).join('　')+'</p><form data-mode="model" class="field-row">'+field('上游模型 ID','<input name="model" required>')+(provider==='opencode-go'?field('官方模型月限额（美元）','<input name="monthlyLimitUSD" type="number" min="1">'):'')+field('模型消耗倍率','<input name="weight" type="number" min=".01" step=".01" value="1" required>')+[['inputPrice','输入'],['cachePrice','缓存命中'],['outputPrice','输出']].map(([k,t])=>field(t+'成本（元 / 百万 Token）','<input name="'+k+'" type="number" min="0" step="0.000001">')).join('')+'<label><input name="enabled" type="checkbox" checked> 开放</label><button class="btn">保存模型</button></form></section>';
 if(p.windows?.length){const rows=p.windows.map(w=>'<tr><td>'+esc(w.label)+'</td><td>'+esc(w.window)+'</td><td>约 ¥'+Number(w.remainingYuan).toFixed(2)+'</td><td>'+esc(new Date(w.checkedAt*1000).toLocaleString())+'</td><td>'+(w.resetAt?esc(new Date(w.resetAt).toLocaleString()):'—')+'</td></tr>').join('');view.querySelector('section').insertAdjacentHTML('beforeend','<h3>Go 额度快照</h3><table><thead><tr><th>账号</th><th>窗口</th><th>剩余折算</th><th>核对时间</th><th>重置时间</th></tr></thead><tbody>'+rows+'</tbody></table>');}
 if(p.meter?.length)view.querySelectorAll('section')[1].insertAdjacentHTML('beforeend','<details><summary>最近 '+p.meter.length+' 次请求明细</summary><div class="table-wrap"><table><thead><tr><th>请求 / 会员</th><th>模型</th><th>输入 / 缓存命中 / 输出 Token</th><th>本次成本（元）</th><th>本次扣额（元）</th><th>预占 → 当前占用（点）</th><th>状态</th></tr></thead><tbody>'+p.meter.map(r=>'<tr><td>#'+esc(r.id)+' · '+esc(r.account)+'</td><td>'+esc(p.models.find(m=>m.id===r.model)?.name??r.model)+'</td><td>'+esc(r.input??'—')+' / '+esc(r.cached??'—')+' / '+esc(r.output??'—')+'</td><td>'+(r.exactYuan==null?'—':Number(r.exactYuan).toFixed(8))+'</td><td>'+(r.state==='ok'?(r.occupied/100).toFixed(4):'—')+'</td><td>'+esc(r.held)+' → '+esc(r.occupied)+'</td><td>'+esc(({pending:'预占',unknown:'待核对',ok:'已结算',rejected:'已退回'})[r.state]??r.state)+'</td></tr>').join('')+'</tbody></table></div></details>');
 view.querySelector('section').insertAdjacentHTML('beforebegin','<section class="card" data-inventory></section>');drawInventory(data.inventory);
 if(!['deepseek','aiopen'].includes(provider))view.insertAdjacentHTML('beforeend','<section class="card"><h2>Token Plan 台账</h2><p>按供应商控制台录入；不计入可共享 API 周容量。用相同备注更新额度。</p>'+p.plans.map(x=>'<p><b>'+esc(x.label)+'</b>　'+x.remaining+' / '+x.total+' '+esc(x.unit)+'　核对于 '+esc(new Date(x.checked*1000).toLocaleString())+'</p>').join('')+'<details><summary>记录套餐额度</summary><form data-mode="plan" class="field-row">'+field('套餐备注','<input required name="label">')+field('单位','<input required name="unit" placeholder="如 Credits">')+field('总额度','<input required name="total" type="number" min="0" step=".01">')+field('剩余','<input required name="remaining" type="number" min="0" step=".01">')+'<button class="btn">保存快照</button></form></details></section>');
 view.querySelectorAll('[data-provider]').forEach(b=>b.onclick=()=>{provider=b.dataset.provider;status.textContent='';render();});
 view.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>{const k=p.keys[+b.dataset.edit],d=view.querySelector('[data-account]'),f=d.querySelector('form');d.open=true;for(const [n,v] of Object.entries({id:k.id,label:k.label,capacity:k.weekly,key:'',wallet:k.wallet??'',unitYuan:k.unitYuan??'',monthlyYuan:k.monthlyYuan??''}))f.elements[n].value=v;f.elements.enabled.checked=k.enabled;f.elements.label.focus();});

 const buttons=[...view.querySelectorAll('[data-balance]')];
 async function check(button,force){
  const k=p.keys[+button.dataset.balance],cell=button.closest('tr').querySelector('[data-quota]'),old=cache.get(k.id);
  if(!force && old && Date.now()-old.time<60000){cell.textContent=old.text;return;}
  button.disabled=true;cell.textContent='正在查询…';
  try{const v=await api({action:'balance',id:k.id});if(!v.balances?.length)throw Error('供应商未返回额度');
   const text=v.balances.map(x=>x.currency+' '+x.amount).join(' · ')+'（'+new Date(v.checkedAt*1000).toLocaleTimeString()+'）';cache.set(k.id,{time:Date.now(),text});cell.textContent=text;if(v.inventory&&button.isConnected){data.inventory=v.inventory;drawInventory(v.inventory);}
  }catch(e){cell.textContent='查询失败：'+e.message+(old?'；上次：'+old.text:'');}finally{button.disabled=false;}
 }
 buttons.forEach(b=>b.onclick=()=>check(b,true));
 void (async()=>{for(const b of buttons){if(!b.isConnected)break;await check(b,false);}})();
 if(provider==='qwen-plan')view.querySelector('[data-account]').before(Object.assign(document.createElement('p'),{textContent:'个人套餐余量来自百炼控制台。首次查询需要为此账号完成一次官方控制台登录。'}));
 view.querySelectorAll('form').forEach(f=>f.onsubmit=async e=>{e.preventDefault();const b=Object.fromEntries(new FormData(f));b.action=f.dataset.mode;b.provider=provider;b.enabled=!!f.elements.enabled?.checked;if(b.ceiling==='')b.ceiling=null;const button=f.querySelector('button');button.disabled=true;try{await api(b);if(f.elements.key)f.elements.key.value='';await load();status.textContent='已保存';}catch(e){status.textContent=e.message;}finally{button.disabled=false;}});
 }
 async function load(){try{data=await api();provider??=data.pools.find(p=>p.keys.length&&supported(p.provider))?.provider??data.pools.find(p=>p.keys.length)?.provider??'qwen';render();}catch(e){status.textContent=e.message;}}
 root.querySelector('[data-refresh]').onclick=async e=>{
  const selected=provider;const b=e.currentTarget;b.disabled=true;
  try{const fresh=await api();const keys=fresh.pools.find(p=>p.provider===selected)?.keys.filter(k=>k.enabled)??[];let failed=0;
   for(const k of keys){try{const r=await api({action:'balance',id:k.id});cache.set(k.id,{time:Date.now(),text:r.balances.map(x=>x.currency+' '+x.amount).join(' · ')});}catch{failed++;}}
   await load();if(provider===selected)status.textContent='已核对 '+(keys.length-failed)+' 个账号'+(failed?'，'+failed+' 个未取得新快照':'');
  }catch(err){status.textContent=err.message;}finally{b.disabled=false;}
 };load();
}
