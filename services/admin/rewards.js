export async function mountRewards(root,api){
 root.innerHTML='<section class="card"><h2>订单与礼品卡</h2><form class="field-row"><label>销售单号<input name="saleOrder" maxlength="100" placeholder="填写闲鱼订单号，留空自动生成"></label><label>发放用途<select name="purpose"><option value="sale">售卖</option><option value="promotion">推广</option></select></label><label>可领取人数<input name="maxClaims" type="number" min="1" max="100000" value="1" required></label><label>奖励类型<select name="kind"><option value="points">点数</option><option value="membership">会员天数</option><option value="reset">周额度重置卡</option></select></label><label hidden>会员套餐<select name="plan"></select></label><label><span data-unit>每人点数</span><input name="quantity" type="number" value="1" min="1" max="100000000" required></label><output data-preview></output><button class="btn primary">生成礼品卡</button></form><p role="status"></p><a hidden target="_blank" rel="noopener noreferrer">查看并保存礼品卡图片</a> <button type="button" class="btn" id="next-sale" hidden>登记下一单</button></section><section class="card"><h2>已支付充值订单</h2><form id="settle" class="field-row"><label>支付订单号<input name="order" maxlength="100" required></label><label>账号 ID<input name="account" required></label><label>实际充值点数<input type="number" name="points" min="1" max="100000000" required></label><button class="btn">确认订单已支付并入账</button></form><p id="receipt" role="status"></p></section><section class="card"><h2>会员套餐售价</h2><form id="offer" class="field-row"><label>套餐<select name="plan"></select></label><label>天数<input name="days" type="number" min="1" max="3660" value="30" required></label><label>售价（点）<input name="price" type="number" min="1" max="100000000" required></label><label><input name="enabled" type="checkbox">上架</label><button class="btn">保存售价</button></form><p id="prices"></p></section><section class="card"><h2>点数溯源</h2><form id="trace" class="field-row"><label>账号 ID<input name="account" required></label><label>流水编号<input name="reference" required></label><button class="btn">查询来源</button></form><p id="sources" role="status"></p><h2>最近点数流水</h2><table><thead><tr><th>账号</th><th>来源 / 订单</th><th>点数</th></tr></thead><tbody></tbody></table></section>';
 const panels=[...root.children];
 const costs=document.createElement('div');
 root.append(costs);
 panels.push(costs);
 const tabs=document.createElement('nav');
 tabs.className='reward-tabs';
 tabs.setAttribute('aria-label','点数与礼品卡');
 const names=['发礼品卡','充值入账','套餐售价','流水查询','成本核算'];
 for(const [index,panel] of panels.entries()){
   const button=document.createElement('button');
   button.type='button';button.className='btn';button.textContent=names[index];
   panel.id='reward-panel-'+index;button.setAttribute('aria-controls',panel.id);
   button.onclick=()=>panels.forEach((entry,i)=>{
     entry.hidden=i!==index;
     tabs.children[i].setAttribute('aria-pressed',String(i===index));
   });
   tabs.append(button);
 }
 root.prepend(tabs);
 tabs.firstElementChild.click();
 void import('./expenses.js').then(m=>m.mountExpenses(costs,api)).catch(()=>{costs.textContent='成本核算加载失败';});

 const trace=root.querySelector('#trace');
 trace.onsubmit=async e=>{e.preventDefault();const out=root.querySelector('#sources');try{const r=await api('points-trace',Object.fromEntries(new FormData(trace)));out.textContent=r.entries.map(l=>l.points+' 点 · '+l.reference+(l.saleOrder?' · 礼品卡订单 '+l.saleOrder:l.order?' · 充值订单 '+l.order.id:'')).join('　')+(r.unmatched?' · 尚未匹配 '+r.unmatched+' 点':'');}catch(error){out.textContent=error.message;}};
 const offer=root.querySelector('#offer');
 offer.onsubmit=async e=>{e.preventDefault();const b=offer.querySelector('button');b.disabled=true;try{await api('plan-offers',{plan:offer.elements.plan.value,days:Number(offer.elements.days.value),price:Number(offer.elements.price.value),enabled:offer.elements.enabled.checked});await refreshPrices();}catch(error){root.querySelector('#prices').textContent=error.message;}finally{b.disabled=false;}};
 const settle=root.querySelector('#settle');
 settle.onsubmit=async e=>{e.preventDefault();const button=settle.querySelector('button');button.disabled=true;
 try{await api('settled-recharges',{...Object.fromEntries(new FormData(settle)),points:Number(settle.elements.points.value)});root.querySelector('#receipt').textContent='订单已入账';settle.reset();await refreshLedger().catch(()=>{root.querySelector('#receipt').textContent+='，流水刷新失败';});}catch(error){root.querySelector('#receipt').textContent=error.message;}finally{button.disabled=false;}};
 const f=panels[0].querySelector('form'),status=panels[0].querySelector('[role=status]'),link=panels[0].querySelector('a');let request=crypto.randomUUID();
 const next=root.querySelector('#next-sale');
 const copy=document.createElement('button');
 copy.type='button';copy.className='btn';copy.textContent='复制领取链接';copy.hidden=true;
 link.after(copy);
 const history=document.createElement('details');
 history.hidden=true;
 const heading=document.createElement('summary');heading.textContent='本页已生成的礼品卡';
 history.append(heading);next.after(history);
 function preview(){
   const kind=f.elements.kind.value;
   f.elements.plan.parentElement.hidden=kind!=='membership';
   const q=f.elements.quantity;
   q.max=kind==='membership'?3660:kind==='reset'?1:100000000;
   q.readOnly=kind==='reset';
   if(q.readOnly)q.value='1';
   const unit=kind==='points'?'点':kind==='membership'?'天':'次';
   f.querySelector('[data-unit]').textContent=kind==='points'?'每人点数':kind==='membership'?'每人会员天数':'每人重置次数';
   const people=f.elements.maxClaims;
   f.querySelector('[data-preview]').textContent=q.validity.valid && people.validity.valid
     ? people.value+' 人可领，每人 '+q.value+' '+unit+'，最多发放 '+(q.valueAsNumber*people.valueAsNumber).toLocaleString('zh-CN')+' '+unit:'';
 }
 function lock(locked){for(const field of f.elements)if('disabled' in field)field.disabled=locked;}
 next.onclick=()=>{lock(false);f.reset();request=crypto.randomUUID();status.textContent='';
   next.hidden=copy.hidden=link.hidden=true;preview();f.elements.saleOrder.focus();};
 f.oninput=()=>{request=crypto.randomUUID();preview();};
 copy.onclick=async()=>{try{await navigator.clipboard.writeText(link.href);status.textContent='领取链接已复制';}
   catch{status.textContent='请在领取链接上使用右键复制链接地址';}};
 preview();
 f.onsubmit=async e=>{
   e.preventDefault();
   if(f.querySelector('button').disabled)return;
   const saleOrder=f.elements.saleOrder.value.trim()||('XS-'+request);
   f.elements.saleOrder.value=saleOrder;
   const data={...Object.fromEntries(new FormData(f)),saleOrder,maxClaims:Number(f.elements.maxClaims.value),quantity:Number(f.elements.quantity.value),request};
   lock(true);
   try{
     const card=await api('gift-cards',data);
     const label=card.kind==='points'?card.quantity+' 点':card.kind==='reset'?'周额度重置一次':card.plan+' · '+card.quantity+' 天';
     link.href='https://shell.canp.ai/rewards/#'+new URLSearchParams({gift:card.code,poster:label,...(card.purpose==='promotion'?{campaign:String(card.maxClaims)}:{})});
     link.hidden=next.hidden=copy.hidden=false;
     status.textContent='已生成 · '+saleOrder+' · '+label;
     const previous=document.createElement('a');
     previous.href=link.href;previous.target='_blank';previous.rel='noopener noreferrer';
     previous.textContent=saleOrder+' · '+label;
     const row=document.createElement('p');row.append(previous);
     heading.after(row);history.hidden=false;
   }catch(error){status.textContent=error.message;lock(false);}
 };
 async function refreshPrices(){
   const sales=await api('plan-offers');
   root.querySelector('#prices').textContent=sales.offers.map(x=>x.plan+' · '+x.days+' 天 · '+x.price+' 点 · '+(x.enabled?'已上架':'已下架')).join('　');
 }
 async function refreshLedger(){
   const finance=await api('points-ledger');
   const body=root.querySelector('tbody');body.replaceChildren();
 for(const row of finance.entries){const tr=document.createElement('tr');for(const value of [row.email||row.account,row.reference,row.points]){const td=document.createElement('td');td.textContent=value;tr.append(td);}const detail=document.createElement('button');detail.className='btn';detail.textContent='溯源';detail.onclick=()=>{trace.elements.account.value=row.account;trace.elements.reference.value=row.reference;trace.requestSubmit();trace.scrollIntoView({block:'center'});};tr.lastChild.append(' ',detail);root.querySelector('tbody').append(tr);}
 }
 try{
   const [accounts]=await Promise.all([api('accounts'),refreshPrices(),refreshLedger()]);
   for(const p of accounts.plans){f.elements.plan.add(new Option(p.name,p.name));offer.elements.plan.add(new Option(p.name,p.name));}
 }catch(error){status.textContent=error.message;}
}