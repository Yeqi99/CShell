export async function mountExpenses(root,api){
 const section=document.createElement('section');section.className='card';root.append(section);
 section.innerHTML='<h2>成本核算</h2><p data-total></p><div data-groups></div><details><summary>模型用量核算</summary><div data-models></div></details><form class="field-row"><label>费用单据号<input name="reference" required maxlength="120"></label><label>用途<select name="category"><option value="sale">售卖成本</option><option value="promotion">推广成本</option><option value="shared">共用成本</option></select></label><label>收款方或资源<input name="destination" required maxlength="120"></label><label>关联订单或推广活动<input name="source" required maxlength="120"></label><label>实际支出（元）<input type="number" min="0.01" step="0.01" name="amount" required></label><button>登记费用</button></form><output></output><details><summary>费用单据</summary><div data-entries></div></details>';
 const fixed=document.createElement('section');
 fixed.innerHTML='<h3>机器月租</h3><p data-monthly-total></p><div data-monthly></div><details><summary>调整月租</summary><form><label>机器名称<input required maxlength="120" name="resource"></label><label>每月金额（元）<input required type="number" min="0" step="0.01" name="amount"></label><button>保存月租</button><output></output></form></details>';
 section.querySelector('[data-total]').before(fixed);
 const ratesForm=fixed.querySelector('form');
 ratesForm.onsubmit=async event=>{event.preventDefault();const btn=ratesForm.querySelector('button'),out=ratesForm.querySelector('output');btn.disabled=true;try{show(await api('expenses',{action:'monthly-rate',resource:ratesForm.elements.resource.value,amountFen:Math.round(Number(ratesForm.elements.amount.value)*100)}));out.textContent='月租已保存';}catch(e){out.textContent=e.message;}finally{btn.disabled=false;}};
 const names={sale:'售卖',promotion:'推广',shared:'共用',unclassified:'待归类'};
 function lines(key,values){section.querySelector('[data-'+key+']').replaceChildren(...values.map(value=>{const p=document.createElement('p');p.textContent=value;return p;}));}
 function show(r){
 fixed.querySelector('[data-monthly-total]').textContent='共用机器固定成本 ¥'+(r.monthlyMachineFen/100).toFixed(2)+' / 月';
 lines('monthly',r.monthlyRates.map(m=>m.resource+' · ¥'+(m.amountFen/100).toFixed(2)+' / 月'));
 section.querySelector('[data-total]').textContent='已登记实际支出 ¥'+(r.totalFen/100).toFixed(2);
 lines('groups',r.groups.map(g=>names[g.category]+' · '+g.destination+' · ¥'+(g.amountFen/100).toFixed(2)));
 lines('models',r.models.map(m=>names[m.category]+' · '+m.provider+' · 用量折算 ¥'+m.estimatedYuan+' · 待定价 '+m.unpriced+' 次'));
 lines('entries',r.entries.map(m=>m.reference+' · '+names[m.category]+' · '+m.destination+' · '+m.source+' · ¥'+(m.amountFen/100).toFixed(2)));}
 const form=section.querySelector('form.field-row'),status=form.nextElementSibling;
 form.onsubmit=async e=>{e.preventDefault();const b=form.querySelector('button');b.disabled=true;try{const d=Object.fromEntries(new FormData(form));show(await api('expenses',{...d,amountFen:Math.round(Number(d.amount)*100)}));form.reset();status.textContent='费用已登记';}catch(e){status.textContent=e.message;}finally{b.disabled=false;}};
 try{show(await api('expenses'));}catch(e){status.textContent=e.message;}
}
