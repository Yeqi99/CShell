/** Uses the same authenticated same-origin admin gateway; no client-side token. */
export function mountFeedback(root) {
  let reports=[], selected=null, busy=false;
  const names={new:'待处理',investigating:'调查中',resolved:'已解决',closed:'已关闭'};
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const api=async(path,body)=>{const r=await fetch('/admin-api/v1/admin/feedback'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},cache:'no-store',...(body?{body:JSON.stringify(body)}:{})});const v=await r.json();if(!r.ok)throw Error(v.error||'反馈服务暂不可用');return v;};
  function draw(message='') {
    root.innerHTML=`<div class="page-head"><div><h1>用户反馈</h1><p>最近 200 条真实反馈 · 仅包含用户主动提交的内容</p></div><button class="btn" id="feedback-refresh">刷新</button></div><p role="status">${esc(message)}</p><section class="card"><div class="table-wrap"><table><thead><tr><th>内容</th><th>版本 / 平台</th><th>状态</th><th>时间</th><th>操作</th></tr></thead><tbody>${reports.map(r=>`<tr><td>${esc(r.message.slice(0,100))}</td><td>${esc(r.version)} / ${esc(r.platform)}</td><td>${esc(names[r.status]||r.status)}</td><td>${esc(new Date(r.createdAt*1000).toLocaleString())}</td><td><button class="textbtn" data-report="${esc(r.id)}">查看详情</button></td></tr>`).join('')}</tbody></table></div>${reports.length?'':'<p class="card-body">暂无已加载反馈</p>'}</section><section class="card" id="feedback-detail" ${selected?'':'hidden'}></section>`;
    root.querySelector('#feedback-refresh').onclick=()=>load();
    root.querySelectorAll('[data-report]').forEach(b=>b.onclick=()=>{selected=reports.find(r=>r.id===b.dataset.report);detail();});
    if(selected)detail();
  }
  function detail(){const r=selected,box=root.querySelector('#feedback-detail');box.hidden=false;box.innerHTML=`<div class="card-body"><h2>反馈详情</h2><p>${esc(r.id)}</p><p style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(r.message)}</p><p>联系方式：${esc(r.contact||'未提供')}</p><details><summary>用户提交的诊断信息</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(r.diagnostic||'无')}</pre></details><form id="feedback-form"><label>处理状态<select name="status">${Object.entries(names).map(([k,v])=>`<option value="${k}" ${r.status===k?'selected':''}>${v}</option>`).join('')}</select></label><label>处理说明<input name="reason" required minlength="2" maxlength="300"></label><div class="form-actions"><button class="btn primary">保存处理结果</button></div><p id="feedback-result" role="status"></p></form></div>`;box.querySelector('form').onsubmit=async e=>{e.preventDefault();if(busy)return;busy=true;const form=e.currentTarget,button=form.querySelector('button');button.disabled=true;try{const result=await api('/status',{id:r.id,previousStatus:r.status,status:form.elements.status.value,reason:form.elements.reason.value});r.status=result.status;draw('处理状态已保存');}catch(error){box.querySelector('#feedback-result').textContent=error.message;}finally{busy=false;button.disabled=false;}};}
  async function load(){if(busy)return;busy=true;try{const value=await api('');reports=value.reports;selected=selected&&reports.find(r=>r.id===selected.id);draw();}catch(e){draw(e.message);}finally{busy=false;}}
  draw('正在加载反馈…');void load();
}

