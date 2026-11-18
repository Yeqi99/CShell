export async function mountRentals(root,api){
  if(!document.querySelector('link[data-rental-style]')){
    const css=document.createElement('link');css.rel='stylesheet';css.href=new URL('./rentals.css',import.meta.url).href;css.dataset.rentalStyle='';document.head.append(css);
  }
  root.innerHTML=`<div class="rental-admin"><header><h1>云机器租赁</h1><span data-provider-state></span></header>
    <nav aria-label="租赁管理视图"><button type="button" data-view="inventory" aria-pressed="true">实例管理</button><button type="button" data-view="specs">基础规格</button><button type="button" data-view="plans">上架定价</button><button type="button" data-view="credits">点数入账</button><button type="button" data-view="providers">服务商与授权</button></nav>
    <section data-page="inventory"><h2>云机器实例</h2><div data-instances></div></section>
    <section data-page="specs" hidden><header><h2>基础规格</h2><select aria-label="选择基础规格" data-spec-selector></select></header><form data-spec></form></section>
    <section data-page="plans" hidden><header><h2>租赁上架</h2><select aria-label="选择套餐" data-selector></select></header><form data-plan></form></section>
    <section data-page="credits" hidden><h2>账号点数入账</h2><form data-credit><label>账号 ID<input name="account" required></label><label>入账流水号<input name="reference" required></label><label>点数<input name="points" type="number" min="1" required></label><footer><button>确认入账</button></footer></form></section>
    <section data-page="providers" hidden><h2>翼龙后台连接</h2><form data-provider><label>后台地址<input name="host" value="pl.deviy.cn" readonly></label><label>Application API 密钥<input name="key" type="password" autocomplete="new-password" required></label><footer><button>验证并保存</button></footer></form></section>
    <section data-page="providers" hidden><h2>服务商授权</h2><form data-grant><label>服务商名称<input name="name" required></label><label>管理套餐<select name="plan" required></select></label><footer><button>生成访问码</button></footer></form><output data-access></output><div data-operators></div></section><p role="status" aria-live="polite"></p></div>`;
  for(const button of root.querySelectorAll('[data-view]'))button.onclick=()=>{
    for(const tab of root.querySelectorAll('[data-view]'))tab.setAttribute('aria-pressed',String(tab===button));
    for(const page of root.querySelectorAll('[data-page]'))page.hidden=page.dataset.page!==button.dataset.view;
    root.querySelector('[data-access]').textContent='';root.querySelector('[role=status]').textContent='';
  };
  const form=root.querySelector('[data-plan]'), status=root.querySelector('[role=status]');
  const specForm=root.querySelector('[data-spec]');
  const specSelect=root.querySelector('[data-spec-selector]'),select=root.querySelector('[data-selector]');
  const specFields={name:'规格名称',system:'系统环境',cpu:'CPU 配额（100 为一核）',memory:'内存 MiB',disk:'磁盘 MiB',node:'节点 ID',egg:'CAgent Egg ID',owner:'托管账号 ID'};
  const priceFields={specId:'基础规格',days:'付款周期',points:'每期点数',expansionDays:'扩容计价周期（天）',cpuPoints:'每核点数',memoryPoints:'每 GiB 内存点数',expansionPoints:'每 10 GiB 磁盘点数',enabled:'开放租赁'};
  function fields(target,labels){
    for(const [key,title] of Object.entries(labels)){
      const label=document.createElement('label');label.textContent=title;
      const input=document.createElement(['days','specId'].includes(key)?'select':'input');
      input.name=key;
      if(input.tagName==='INPUT'){input.type=key==='enabled'?'checkbox':['name','system'].includes(key)?'text':'number';if(input.type==='number')input.min=1;}
      if(key==='enabled'){label.className='check';label.prepend(input);}else{input.required=true;label.append(input);}
      target.append(label);
    }
    const footer=document.createElement('footer'),button=document.createElement('button');
    button.textContent=target===specForm?'保存基础规格':'保存租价';footer.append(button);target.append(footer);
  }
  fields(specForm,specFields);fields(form,priceFields);
  let plans=[],specs=[];
  function fillSpec(){const row=specs.find(p=>p.id===specSelect.value)||{system:'Linux x64 · CAgent',cpu:200,memory:4096,disk:30720};
    for(const k of Object.keys(specFields))specForm.elements[k].value=row[k]??'';
  }
  function fill(){const row=plans.find(p=>p.id===select.value)||{days:30,expansionDays:30,cpuPoints:500,memoryPoints:500,expansionPoints:200,enabled:false};
    const periods=[...new Set([1,30,row.days])];form.elements.days.replaceChildren(...periods.map(d=>new Option(d===1?'日租':d===30?'月租':d+' 天',d)));
    for(const k of Object.keys(priceFields)){const input=form.elements[k];if(k==='enabled')input.checked=row.enabled;else input.value=row[k]??(k==='specId'?specs[0]?.id:'')??'';}
    form.elements.specId.disabled=!!select.value;
  }
  async function refresh(){
    const state=await api('rentals/settings');specs=state.plans.filter(p=>p.specOnly);plans=state.plans.filter(p=>!p.specOnly);
    const lastSpec=specSelect.value,lastPrice=select.value;
    specSelect.replaceChildren(new Option('新建基础规格',''),...specs.map(p=>new Option(p.name,p.id)));specSelect.value=lastSpec;
    select.replaceChildren(new Option('新增上架价格',''),...plans.map(p=>new Option(p.name+' · '+p.days+' 天 · '+p.points+' 点'+(p.enabled?'':' · 已下架'),p.id)));select.value=lastPrice;
    form.elements.specId.replaceChildren(...specs.map(p=>new Option(p.name,p.id)));fillSpec();
    const grant=root.querySelector('[data-grant]');
    grant.elements.plan.replaceChildren(...plans.map(p=>new Option(p.name,p.id)));
    const list=root.querySelector('[data-operators]');list.replaceChildren();
    const instances=root.querySelector('[data-instances]');instances.replaceChildren();
    const inventory=await api('rentals/machines');
    if(!inventory.machines.length)instances.textContent='暂无实例';
    for(const machine of inventory.machines){
      const row=document.createElement('div');row.className='rental-row';
      const title=document.createElement('div'),name=document.createElement('strong'),id=document.createElement('small'),state=document.createElement('span'),disk=document.createElement('span');
      name.textContent=machine.plan;id.textContent=machine.id;title.append(name,id);state.className='rental-state';state.dataset.state=machine.state;state.textContent=({ready:'可用',paused:'已暂停',provisioning:'创建中',failed:'创建失败'})[machine.state]??machine.state;
      disk.textContent=Number.isFinite(Number(machine.disk))?Number((machine.disk/1024).toFixed(2))+' GiB 磁盘':'—';row.append(title,state,disk);
      if(['ready','paused'].includes(machine.state)){
        const pause=machine.state==='ready',button=document.createElement('button');button.textContent=pause?'暂停':'恢复';
        button.onclick=async()=>{if(pause&&!confirm('暂停将中断此实例的会话，确认继续？'))return;
          try{await api('rentals/machines',{id:machine.id,action:pause?'pause':'resume'});await refresh();}catch(e){status.textContent=e.message;}};
        row.append(button);
      }
      instances.append(row);
    }
    const roles=await api('rentals/operators');
    for(const role of roles.operators){
      const line=document.createElement('p'),revoke=document.createElement('button');
      line.textContent=role.name+' · '+role.plans.join(', ')+' ';revoke.textContent='撤销';
      revoke.onclick=async()=>{try{await api('rentals/operators',{revoke:role.id});await refresh();}catch(e){status.textContent=e.message;}};
      line.className='rental-operator';line.append(revoke);list.append(line);
    }
    grant.onsubmit=async e=>{e.preventDefault();try{
      const g=await api('rentals/operators',{name:grant.elements.name.value,plans:[grant.elements.plan.value]});await refresh();
      root.querySelector('[data-access]').textContent=g.url+' 访问码 '+g.access;
    }catch(e){status.textContent=e.message;}};
    root.querySelector('[data-provider-state]').textContent=state.configured?'已配置供应商':'待配置供应商密钥';fill();
  }
  select.onchange=fill;
  function bind(form,action,body){
    form.onsubmit=async e=>{e.preventDefault();const button=form.querySelector('button');button.disabled=true;
      try{await api('rentals/'+action,body());if(action==='settings')form.elements.key.value='';
        await refresh();status.textContent='已保存';}
      catch(e){status.textContent=e.message;}finally{button.disabled=false;}};
  }
  const provider=root.querySelector('[data-provider]'),credit=root.querySelector('[data-credit]');
  bind(provider,'settings',()=>Object.fromEntries(new FormData(provider)));
  bind(credit,'credit',()=>({...Object.fromEntries(new FormData(credit)),points:Number(credit.elements.points.value)}));
  specSelect.onchange=fillSpec;
  function payload(target,keys){
    return Object.fromEntries(Object.keys(keys).map(k=>{const input=target.elements[k];return [k,input.type==='checkbox'?input.checked:input.type==='number'||k==='days'?Number(input.value):input.value];}));
  }
  bind(specForm,'plan',()=>({kind:'spec',id:specSelect.value||crypto.randomUUID(),...payload(specForm,specFields)}));
  bind(form,'plan',()=>({kind:'rate',id:select.value||crypto.randomUUID(),...payload(form,priceFields)}));
  try{await refresh();}catch(e){status.textContent=e.message;}
}
