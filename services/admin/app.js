import {mountTraffic} from './traffic.js';
import {mountFeedback} from './feedback.js';
const icons = {
 dashboard:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
 users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/><circle cx="9" cy="7" r="4"/>',
 shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
 crown:'<path d="m3 6 4 4 5-6 5 6 4-4-2 12H5L3 6Zm2 15h14"/>',
 orders:'<path d="M6 3h12v19l-3-2-3 2-3-2-3 2V3Zm3 5h6m-6 4h6m-6 4h3"/>',
 model:'<path d="m12 2 9 5v10l-9 5-9-5V7l9-5Zm0 10 9-5m-9 5L3 7m9 5v10m-4.5-17.5 9 5"/>',
 wallet:'<path d="M20 8V5H5a3 3 0 0 0 0 6h16v9H5a3 3 0 0 1-3-3V8m19 6h-5v3h5"/>',
 activity:'<path d="M3 12h4l3-8 4 16 3-8h4"/>',
 chart:'<path d="M3 3v18h18M7 16v-5m5 5V7m5 9V4"/>',
 clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
 settings:'<path d="m10 3-.6 2.2-2 .9-2-.7L3.5 8l1.5 1.6v2.8l-1.5 1.7 1.9 3.2 2.2-.5 1.8 1.1.6 2.1h4l.6-2.1 1.8-1.1 2.2.5 1.9-3.2-1.5-1.7V9.6L20.5 8l-1.9-3.6-2 .7-2-.9L14 3h-4Z"/><circle cx="12" cy="11.5" r="3"/>',
 search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
 arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>',chevron:'<path d="m9 5 7 7-7 7"/>',
 plus:'<path d="M12 5v14M5 12h14"/>', close:'<path d="m6 6 12 12M6 18 18 6"/>',
 download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
 upload:'<path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5"/>',
 refresh:'<path d="M20 7v5h-5M4 17v-5h5m-4-4a8 8 0 0 1 13-3l2 3M4 16l2 3a8 8 0 0 0 13-3"/>',
 info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',check:'<path d="m5 12 4 4L19 6"/>',
 sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
 moon:'<path d="M20 14A9 9 0 0 1 10 3a9 9 0 1 0 10 11Z"/>',
 bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
 menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
 server:'<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6h.01M7 17h.01m5-11h5m-5 11h5"/>',
 mail:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/>',
 link:'<path d="m10 13 4-4m-6 6-2 2a4 4 0 0 1-5-5l4-4a4 4 0 0 1 6 0m2 2a4 4 0 0 1 0 6l-4 4m6-10 2-2a4 4 0 0 0-5-5l-3 3"/>',
 eye:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
 trash:'<path d="M3 6h18M9 6V3h6v3m-10 0 1 15h12l1-15M10 10v7m4-7v7"/>',
 file:'<path d="M14 2H5v20h14V7l-5-5Zm0 0v6h5M8 12h8m-8 4h6"/>'
};
const icon = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[n]||icons.file}</svg>`;
const esc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pages={rewards:['点数与礼品卡','orders','运营'],rentals:['云机器租赁','server','运营'],overview:['运营概览','dashboard','运营'],accounts:['账号与会员','users','运营'],feedback:['用户反馈','activity','运营'],pool:['会员模型号池','model','Pro 权益'],traffic:['流量与成本','activity','Pro 权益'],consumption:['模型使用记录','orders','监控'],analytics:['使用分析','chart','监控'],audit:['操作审计','clock','监控']};
const oldRoutes={membership:'accounts',models:'pool',points:'pool'};const route=()=>{const k=location.hash.slice(1);return Object.hasOwn(pages,k)?k:Object.hasOwn(oldRoutes,k)?oldRoutes[k]:'overview';};let page=route(),mobile=false;
let theme=localStorage.getItem('cshell-admin-theme')||'light';
const badge=(s,t)=>`<span class="badge ${t||''}">${esc(s)}</span>`;
const btn=(label,action,primary=false,ico='',extra='')=>`<button class="btn${primary?' primary':''}" data-action="${action}" ${extra}>${ico?icon(ico):''}${esc(label)}</button>`;
const ibtn=(label,action,ico)=>`<button class="iconbtn" title="${esc(label)}" aria-label="${esc(label)}" data-action="${action}">${icon(ico)}</button>`;
const link=(label,p)=>`<button class="textbtn" data-nav="${p}">${esc(label)}${icon('arrow')}</button>`;
function toast(message){const el=document.getElementById('toast');el.textContent=message;el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),3500);}
function notice(text,action=''){return `<div class="notice">${icon('info')}<span>${text}</span>${action}</div>`;}
function header(title,description,actions='',eyebrow=''){return `<div class="page-head"><div>${eyebrow?`<div class="eyebrow">${eyebrow}</div>`:''}<h1>${title}</h1><p>${description}</p></div><div class="actions">${actions}</div></div>`;}
function table(headers,rows,emptyContent){return `<div class="table-wrap"><table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.join(''):`<tr><td colspan="${headers.length}">${emptyContent}</td></tr>`}</tbody></table></div><div class="table-summary"><span>${rows.length} 条${['overview','pool','accounts','audit','consumption','analytics'].includes(page)?'记录':'本地草稿'}</span><span>第 1 页</span></div>`;}
let modelUsage={usage:[],recent:[]};
let production={accounts:[],audit:[]}, productionError='', productionLoaded=false;
let productionLending={loans:[]},lendingError='';
function render(){document.body.classList.toggle('dark',theme==='dark');document.title=`${pages[page][0]} · CShell Pro`;let last='';document.getElementById('app').innerHTML=`<div class="shell"><aside class="sidebar ${mobile?'open':''}"><a class="brand" href="#overview" aria-label="CShell 运营概览"><img src="icon.svg" alt="">CShell <small>PRO</small></a><div class="workspace"><span class="dot"></span><div>管理控制台<small>账号与会员运营</small></div></div><nav class="nav" aria-label="管理导航">${Object.entries(pages).map(([p,[label,ico,group]])=>{const head=group!==last?`<div class="navgroup">${group}</div>`:'';last=group;return head+`<button data-nav="${p}" class="${page===p?'active':''}" ${page===p?'aria-current="page"':''}>${icon(ico)}${label}</button>`;}).join('')}</nav><div class="sidebar-foot"><div class="user"><span class="avatar">C</span><strong>管理员</strong></div></div></aside><div class="layout"><header class="topbar"><div class="crumb"><button class="iconbtn bare mobile-menu" data-action="menu" aria-label="打开导航">${icon('menu')}</button><span>管理控制台</span>${icon('chevron')}<strong>${pages[page][0]}</strong></div><div class="toptools"><div class="searchwrap"><label class="global-search">${icon('search')}<input id="global-search" placeholder="搜索功能…" aria-label="搜索管理功能" autocomplete="off"><span class="key">Ctrl K</span></label><div id="search-results" class="search-results" hidden></div></div><span class="env"><span class="dot"></span>生产管理</span><button class="iconbtn bare" data-nav="audit" title="查看操作记录" aria-label="查看操作记录">${icon('clock')}</button><span class="avatar">C</span></div></header><main class="main" id="main">${({rewards:()=>'<section id="rewards"></section>',rentals:()=>'<section id="rental-settings"></section>',overview,accounts,consumption,analytics,traffic,feedback,audit,pool:()=>'<div id="production-pool"></div>'}[page])()}<footer class="page-footer"><span>CShell Pro · 管理控制台</span><span class="statusfooter"><span class="dot"></span>生产管理</span></footer></main></div></div><button class="iconbtn theme" data-action="theme" title="切换到${theme==='light'?'深色':'浅色'}主题" aria-label="切换到${theme==='light'?'深色':'浅色'}主题">${icon(theme==='light'?'moon':'sun')}</button>`;bind();bindAccounts();bindLoans();mountPage();}
function go(p){mobile=false;location.hash=p;if(page===p)render();}function bind(){
 document.querySelectorAll('[data-nav]').forEach(b=>b.onclick=()=>go(b.dataset.nav));
 document.getElementById('global-search')?.addEventListener('input',e=>{const q=e.target.value.trim(),results=document.getElementById('search-results');results.hidden=!q;const found=Object.entries(pages).filter(([p,[t,,g]])=>`${t}${g}`.includes(q));results.innerHTML=found.length?found.map(([p,[t,,g]])=>`<button data-result="${p}">${t}<small>${g}</small></button>`).join(''):'<div class="mini-empty">没有匹配的功能</div>';results.querySelectorAll('[data-result]').forEach(b=>b.onclick=()=>go(b.dataset.result));});
document.querySelector('[data-action=menu]').onclick=()=>document.querySelector('.sidebar').classList.toggle('open');document.querySelector('[data-action=theme]').onclick=e=>{theme=theme==='light'?'dark':'light';localStorage.setItem('cshell-admin-theme',theme);document.body.classList.toggle('dark',theme==='dark');e.currentTarget.innerHTML=icon(theme==='light'?'moon':'sun');e.currentTarget.title=e.currentTarget.ariaLabel='切换主题';};}
window.addEventListener('hashchange',()=>{page=route();render();window.scrollTo(0,0);});document.addEventListener('keydown',e=>{if(e.ctrlKey&&e.key.toLowerCase()==='k'){e.preventDefault();document.querySelector('#global-search').focus();}if(e.key==='Escape'){document.querySelector('#search-results').hidden=true;document.querySelector('.sidebar').classList.remove('open');}});
document.addEventListener('click',e=>{if(!e.target.closest('.searchwrap')){const r=document.getElementById('search-results');if(r)r.hidden=true;}});
function accountOverview(){return header('账号管理','来自云同步服务的真实账号。会员变更会记录审计，并在客户端刷新。','')+`<p role="status">${esc(productionError || (productionLoaded?'':'正在读取…'))}</p><section class="card">${table(['邮箱','会员','云空间','云端版本','有效期','操作'],production.accounts.map(a=>`<tr><td>${esc(a.email)}</td><td>${badge(a.membership.active?(a.plan||'Pro 会员'):'普通账号',a.membership.active?'amber':'')}</td><td>${a.storage?((a.storage.usedBytes/1048576).toFixed(2)+' / '+Math.round(a.storage.limitBytes/1048576)+' MiB'):'—'}</td><td>${a.revision}</td><td>${a.membership.expiresAt?esc(new Date(a.membership.expiresAt*1000).toLocaleString()):'—'}</td><td><button class="textbtn" data-member="${esc(a.id)}">管理会员</button></td></tr>`),'<p>暂无账号</p>')}</section>${planEditor()}<section id="member-editor" class="card" hidden></section>`;};
function audit(){return header('操作审计','服务器记录的会员变更与机器借用撤销。','')+`<section class="card">${table(['时间','账号','操作','详情'],production.audit.map(a=>`<tr><td>${esc(new Date(a.at*1000).toLocaleString())}</td><td>${esc(production.accounts.find(x=>x.id===a.account)?.email||a.account)}</td><td>${esc(a.action === 'lending.revoke' ? '撤销机器借用' : a.action === 'membership' ? '会员变更' : a.action)}</td><td>${esc(a.detail)}</td></tr>`),'<p>暂无管理操作记录</p>')}</section>`;};
function planEditor(){
 const options=(production.machines||[]).map(m=>`<option value="${esc(m.id)}">${esc(m.name)} · ${m.cpu/100} 核 / ${m.memory} MiB / ${m.disk} MiB</option>`).join('');
 const cards=(production.plans||[]).map(p=>{
  const machine=(production.machines||[]).find(m=>m.id===p.machine);
  return `<button type="button" class="plan-card" data-plan="${esc(p.name)}" aria-label="编辑 ${esc(p.name)}"><strong>${esc(p.name)}</strong><span>¥${(p.weeklyCents/100).toFixed(2)} / 周 · ${p.storageMiB} MiB 云空间</span><small>${esc(machine?.name||(p.machine==='*'?'Pro 会员机器':'无附赠机器'))}</small></button>`;
 }).join('');
 return `<section class="card"><h2>会员套餐</h2><div class="plan-cards">${cards}<button type="button" class="plan-card plan-add" data-plan="">＋ 新增套餐</button></div><form id="plan-form" hidden><h3></h3><label>套餐名称<input name="plan" required maxlength="60"></label><label>每周 100% 额度（元）<input name="yuan" type="number" min=".01" max="100000" step=".01" required></label><label>云空间（MiB）<input name="space" type="number" min="1" max="256" required></label><label>会员机器规格<select name="machine"><option value="">无附赠机器</option><option value="*" hidden>原 Pro 可领规格</option>${options}</select></label><div class="plan-actions"><button class="btn primary">保存套餐</button><button class="btn" type="button" data-close-plan>取消</button></div><output></output></form></section>`;
}
function planOptions(){return (production.plans||[]).map(p=>`<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('');}
function bindPlanEditor(){
 const form=document.querySelector('#plan-form');if(!form)return;
 const f=form.elements;
 const cards=form.parentElement.querySelectorAll('[data-plan]');
 for(const card of cards)card.onclick=()=>{
  const p=(production.plans||[]).find(p=>p.name===card.dataset.plan);
  for(const item of cards)item.setAttribute('aria-expanded',String(item===card));
  form.reset();form.dataset.edit=p?.name||'';form.hidden=false;
  form.querySelector('h3').textContent=p?'编辑套餐 · '+p.name:'新增套餐';
  f.plan.value=p?.name||'';f.yuan.value=p?p.weeklyCents/100:'';f.space.value=p?.storageMiB||'';f.machine.value=p?.machine||'';f.plan.readOnly=!!p;
  form.querySelector('output').textContent='';(p?f.yuan:f.plan).focus();
 };
 form.querySelector('[data-close-plan]').onclick=()=>{form.hidden=true;for(const card of cards){if(card.getAttribute('aria-expanded')==='true')card.focus();card.setAttribute('aria-expanded','false');}};
 form.onsubmit=async e=>{e.preventDefault();const output=form.querySelector('output');try{
 if(!form.dataset.edit&&(production.plans||[]).some(p=>p.name===f.plan.value.trim()))throw Error('名称已存在，请选择该套餐进行编辑');
 await productionApi('membership',{action:'savePlan',plan:f.plan.value,weeklyCents:Math.round(Number(f.yuan.value)*100),storageMiB:Number(f.space.value),machine:f.machine.value});await loadProduction();toast('套餐已保存');
 }catch(err){output.textContent=err.message;}};
}
function grantEditor(){return (production.plans||[]).length?`<form id="grant-form"><label>会员套餐<select name="plan">${planOptions()}</select></label><label>发放天数<input name="days" type="number" required min="1" max="3660" value="30"></label><p>套餐立即生效，有效会员从原到期日续期。</p><button class="btn primary">发放会员</button><output></output></form>`:'';}
function bindGrant(account){
 const form=document.querySelector('#grant-form');if(!form)return;
 const request=crypto.randomUUID();
 form.onsubmit=async e=>{e.preventDefault();const button=form.querySelector('button');button.disabled=true;try{
 await productionApi('membership',{action:'grantPlan',account,plan:form.elements.plan.value,days:Number(form.elements.days.value),request});await loadProduction();toast('会员已发放');
 }catch(err){form.querySelector('output').textContent=err.message;button.disabled=false;}};
}
function bindAccounts(){bindPlanEditor();document.querySelectorAll('[data-member]').forEach(button=>button.onclick=()=>{const a=production.accounts.find(x=>x.id===button.dataset.member);const box=document.getElementById('member-editor');box.hidden=false;box.innerHTML=`<h2>管理会员 · ${esc(a.email)}</h2>${grantEditor(a)}<form id="member-form"><label>会员到期日期<input type="date" name="expires" required></label><label>操作原因<input name="reason" required minlength="2" maxlength="300" placeholder="例如：内测赠送 30 天"></label><p class="muted">此操作会修改真实会员状态，不创建付款订单。</p><button class="btn primary">保存会员有效期</button><button type="button" class="btn" id="member-cancel">取消</button><p id="member-result" role="status"></p></form>`;bindGrant(a.id);document.getElementById('member-cancel').onclick=()=>box.hidden=true;document.getElementById('member-form').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget,submit=form.querySelector('button');submit.disabled=true;try{await productionApi('membership',{account:a.id,expiresAt:new Date(form.elements.expires.value+'T23:59:59').getTime()/1000,reason:form.elements.reason.value});await loadProduction();}catch(err){document.getElementById('member-result').textContent=err.message;submit.disabled=false;}};box.scrollIntoView({block:'nearest'});});};
async function productionApi(path,body){const response=await fetch('/admin-api/v1/admin/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const value=await response.json();if(!response.ok)throw Error(value.error||'读取失败');return value;}
async function loadProduction(){try{[production,modelUsage]=await Promise.all([productionApi('accounts'),productionApi('model-usage')]);productionLoaded=true;productionError='';}catch(e){productionError=e.message;}
  try{productionLending=await productionApi('lending');lendingError='';}catch(e){lendingError=e.message;}
  if(['overview','accounts','audit','analytics','consumption'].includes(page))render();}
function consumption(){return header('模型使用记录','最近 100 次请求。会员模型按倍率计点，自建免费模型单独统计。','')+`<section class="card">${table(['请求','账号','模型','输入 / 输出 Token','状态','时间'],modelUsage.recent.map(r=>`<tr><td>#${r.id}</td><td>${esc(production.accounts.find(a=>a.id===r.account)?.email||r.account)}</td><td>${esc(r.model)}</td><td>${r.inputTokens} / ${r.outputTokens}</td><td>${badge(r.success?(r.model.startsWith('pool-')?'完成 · 会员模型':'完成 · 免费'):'失败',r.success?'green':'')}</td><td>${esc(new Date(r.at*1000).toLocaleString())}</td></tr>`),'<p>暂无模型请求记录</p>')}</section>`;};
function analytics(){const total=modelUsage.usage.reduce((n,r)=>n+r.requests,0),ok=modelUsage.usage.reduce((n,r)=>n+r.succeeded,0);return header('使用分析','最近 30 天 · 官方模型网关的真实计量','')+`<section class="card"><div class="card-body"><div class="kv"><span>模型请求</span><strong>${total}</strong></div><div class="kv"><span>成功率</span><strong>${total?(ok/total*100).toFixed(1)+'%':'暂无请求'}</strong></div><div class="kv"><span>使用模型的账号</span><strong>${new Set(modelUsage.usage.map(r=>r.account)).size}</strong></div></div>${table(['账号','模型','请求数','输入 Token','输出 Token'],modelUsage.usage.map(r=>`<tr><td>${esc(production.accounts.find(a=>a.id===r.account)?.email||r.account)}</td><td>${esc(r.model)}</td><td>${r.requests}</td><td>${r.inputTokens}</td><td>${r.outputTokens}</td></tr>`),'<p>暂无使用记录</p>')}</section>`;};
function overview(){
 const cards=[['注册账号',production.accounts.length,'accounts'],['有效会员',production.accounts.filter(a=>a.membership.active).length,'accounts'],['近 30 天模型请求',modelUsage.usage.reduce((n,r)=>n+r.requests,0),'analytics'],['失败请求',modelUsage.usage.reduce((n,r)=>n+r.requests-r.succeeded,0),'consumption']];
 return header('运营概览','账号、会员权益和模型网关运行情况。',link('管理号池','pool'))+(productionError?notice(esc(productionError)):'')+'<div class="stats">'+cards.map(([label,value,target])=>'<section class="card card-body"><h3>'+label+'</h3><strong class="plan-price">'+(productionLoaded?value:'—')+'</strong><p>'+link('查看明细',target)+'</p></section>').join('')+'</div><section class="card card-body"><h2>会员服务</h2><p>'+link('调整模型周额度和倍率','pool')+'　'+link('管理中继与 MCP 流量','traffic')+'　'+link('查看操作审计','audit')+'</p></section>';
};
function accounts(){return accountOverview()+`<section class="card production-loans"><div class="card-head"><div><h2>机器借用授权</h2><p class="muted">查看授权期限与范围，撤销会终止借用连接。</p></div>${btn('刷新','refresh-lending',false,'refresh')}</div>${lendingError?`<p role="status" class="card-body">${esc(lendingError)}</p>`:table(['拥有者','借用范围','接收方式','期限','状态','操作'],productionLending.loans.map(loan=>{
  const active=!loan.revoked&&loan.expiresAt*1000>Date.now();
  return `<tr><td>${esc(production.accounts.find(a=>a.id===loan.owner)?.email||loan.owner)}</td><td>${loan.deviceIds.length} 台机器</td><td>${esc(loan.email||`分享码 · 最多 ${loan.maxUses} 人`)}</td><td>${esc(new Date(loan.expiresAt*1000).toLocaleString())}</td><td>${badge(loan.revoked?'已撤销':active?'有效':'已到期',active?'green':'')}</td><td>${active?`<button class="textbtn" data-revoke-loan="${esc(loan.id)}">撤销授权</button>`:'—'}</td></tr>`;
}),'<p>暂无机器借用授权</p>')}<div id="loan-revoke-editor" class="card-body" hidden></div></section>`;};
function bindLoans(){
  document.querySelector('[data-action="refresh-lending"]')?.addEventListener('click',()=>void loadProduction());
  document.querySelectorAll('[data-revoke-loan]').forEach(button=>button.addEventListener('click',()=>{
    const loan=productionLending.loans.find(item=>item.id===button.dataset.revokeLoan);if(!loan)return;
    const box=document.getElementById('loan-revoke-editor');box.hidden=false;
    box.innerHTML=`<h3>撤销此项机器借用</h3><p>将停止此授权下的 ${loan.deviceIds.length} 台机器借用；拥有者的连接不受影响。</p><form id="loan-revoke-form"><label>撤销原因<input name="reason" minlength="2" maxlength="300" required autocomplete="off"></label><div class="form-actions"><button class="btn primary" type="submit">确认撤销</button><button class="btn" type="button" id="loan-revoke-cancel">取消</button></div><p role="status" id="loan-revoke-result"></p></form>`;
    document.getElementById('loan-revoke-cancel').onclick=()=>box.hidden=true;
    document.getElementById('loan-revoke-form').onsubmit=async event=>{
      event.preventDefault();const form=event.currentTarget,submit=form.querySelector('[type=submit]');submit.disabled=true;
      try{await productionApi('lending/revoke',{id:loan.id,reason:form.elements.reason.value.trim()});await loadProduction();toast('借用授权已撤销');}
      catch(error){document.getElementById('loan-revoke-result').textContent=error.message;submit.disabled=false;}
    };box.scrollIntoView({block:'nearest'});box.querySelector('input').focus();
  }));
};
function feedback(){return `<div id="production-feedback"></div>`;}
function traffic(){return '<div id="production-traffic"></div>';}
function mountPage(){if(page==='rewards')import('./rewards.js').then(m=>m.mountRewards(document.querySelector('#rewards'),productionApi));if(page==='rentals')import('./rentals.js').then(m=>m.mountRentals(document.querySelector('#rental-settings'),productionApi));const pool=document.querySelector('#production-pool');if(pool)import('./model-pool.js?v=2').then(m=>m.mountPool(pool)).catch(()=>pool.textContent='无法加载模型号池');if(page==='feedback')mountFeedback(document.querySelector('#production-feedback'));if(page==='traffic')mountTraffic(document.querySelector('#production-traffic'));}render();void loadProduction();
