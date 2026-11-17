const login=document.querySelector('#login'),statusLine=document.querySelector('#status');
let access='';
async function request(body){
 const r=await fetch('/api/v1/rentals/supplier',{method:body?'POST':'GET',headers:{Authorization:'Bearer '+access,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,cache:'no-store'});
 const data=await r.json();if(!r.ok)throw Error(data.error||'请求失败');return data;
}
function el(tag,text){const node=document.createElement(tag);node.textContent=text;return node;}
function show(data){
 const plans=document.querySelector('#plans'),machines=document.querySelector('#machines');
 plans.replaceChildren(el('h2','套餐配置'));machines.replaceChildren(el('h2','已分配实例'));
 for(const p of data.plans){
  const form=document.createElement('form');form.append(el('h3',p.name));
  for(const [key,label] of Object.entries({cpu:'CPU 配额（100 为一核）',memory:'内存 MiB',disk:'磁盘 MiB',enabled:'开放租赁'})){
   const field=el('label',label),input=document.createElement('input');input.name=key;
   if(key==='enabled'){input.type='checkbox';input.checked=p[key];}else{input.type='number';input.min='1';input.required=true;input.value=p[key];}
   field.append(input);form.append(field);
  }
  const save=el('button','保存');form.append(save);
  form.onsubmit=async e=>{e.preventDefault();save.disabled=true;try{
   show(await request({id:p.id,cpu:Number(form.elements.cpu.value),memory:Number(form.elements.memory.value),disk:Number(form.elements.disk.value),enabled:form.elements.enabled.checked}));
   statusLine.textContent='已保存，新配置适用于之后开通的机器';
  }catch(e){statusLine.textContent=e.message;}finally{save.disabled=false;}};plans.append(form);
 }
 if(!data.machines.length)machines.append(el('p','暂无实例'));
 for(const m of data.machines){
  const line=el('article',m.plan+' · '+m.id+' · '+({ready:'运行中',paused:'服务商已暂停',queued:'等待分配',installing:'安装中',expired:'已到期',failed:'失败',resuming:'恢复中'}[m.state]||m.state)+' · '+m.disk+' MiB ');
  if(['paused','ready'].includes(m.state)){
   const pause=m.state==='ready',btn=el('button',pause?'暂停实例':'恢复实例');
   btn.onclick=async()=>{if(pause&&!confirm('暂停将中断此实例的会话，确认继续？'))return;btn.disabled=true;
    try{show(await request({id:m.id,action:pause?'pause':'resume'}));}catch(e){statusLine.textContent=e.message;}finally{btn.disabled=false;}};
   line.append(btn);
  }
  machines.append(line);
 }
}
login.onsubmit=async e=>{e.preventDefault();access=login.elements.key.value.trim();try{show(await request());login.reset();login.hidden=true;statusLine.textContent='';}catch(e){access='';statusLine.textContent=e.message;}};
