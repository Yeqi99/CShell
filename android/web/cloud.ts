import { defaults, profileSchema } from '../../src/shared/contracts';
type CloudState = { email: string; unlocked: boolean; revision: number; lastSync?: number; membership?: {active: boolean; expiresAt: number | null} };
export class MobileCloud {
  private pending = new Map<string,{resolve:(v:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  private state?: CloudState;
  private busy=false;
  private offline=false;
  private conflict=false;
  constructor(private native:{cloudRequest?(json:string):void},private snapshot:()=>{profiles:unknown[];theme:string},private restore:(data:any)=>void) {
    const root=document.getElementById('cloud-sync')!;
    root.innerHTML=`<div id="cloud-auth"><div class="account-heading"><img src="icon.png" alt="CShell Pro" width="42" height="42"><h1 id="cloud-auth-title">登录 CShell</h1><p>在你的设备间，延续工作。</p></div>
    <form id="cloud-login"><label>邮箱地址<input name="email" type="email" autocomplete="email" placeholder="name@example.com" required></label>
    <label id="cloud-register-code" hidden>邮箱验证码<div class="cloud-input-wrap"><input id="cloud-register-otp" aria-label="注册验证码" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" placeholder="6 位验证码"><button type="button" id="cloud-register-send">发送验证码</button></div></label><div class="cloud-secret-label"><span id="cloud-secret-title">密码</span><button type="button" id="cloud-mode-code">用验证码登录</button><button type="button" id="cloud-mode-password" hidden>用密码登录</button></div>
    <div id="cloud-password-field" class="cloud-input-wrap"><input aria-label="密码" name="password" type="password" autocomplete="current-password" placeholder="输入你的密码" maxlength="128" required><button type="button" id="cloud-eye" aria-label="显示密码">显示</button></div>
    <div id="cloud-code-field" class="cloud-input-wrap" hidden><input aria-label="验证码" name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" placeholder="6 位验证码"><button type="button" id="cloud-code">发送验证码</button></div>
    <button class="primary" id="cloud-password-login" type="submit">登录 <span>→</span></button></form>
    <div class="cloud-auth-note">登录后自动同步连接、模型与设置</div><p class="cloud-auth-switch"><span id="cloud-switch-description">还没有账号？</span><button type="button" id="cloud-register-toggle">创建账号</button></p></div>
    <div id="cloud-profile" hidden><div class="cloud-page-heading"><span>个人中心</span><small>CShell Pro</small></div><div class="cloud-identity"><div id="cloud-avatar"></div><div><h1 id="cloud-name"></h1><p id="cloud-account"></p></div><span id="cloud-membership" hidden>PRO</span></div>
    <div class="cloud-sync-strip"><span id="cloud-sync-dot"></span><div><strong id="cloud-sync-title"></strong><p id="cloud-sync-state"></p></div></div>
    <section class="cloud-info"><h2>账户信息</h2><div><span>当前方案</span><span id="cloud-plan"></span></div><div id="cloud-expiry-row" hidden><span>有效期</span><span id="cloud-expiry"></span></div></section>
    <section class="cloud-info"><h2>跨设备同步</h2><div><span>连接与已保存凭据</span><small>✓ 自动同步</small></div><div><span>基座模型与个人设置</span><small>✓ 自动同步</small></div></section>
    <div id="cloud-unlock" hidden><p>使用账号密码，恢复此设备上的加密配置。</p><input id="cloud-key" type="password" autocomplete="current-password" aria-label="账号密码"><button id="cloud-unlock-button">继续</button></div>
    <div id="cloud-conflict" hidden><p>两台设备同时修改了配置，请选择保留哪一份。另一份会先备份。</p><button id="cloud-download">保留云端更改</button><button id="cloud-upload">保留此设备更改</button></div>
    <div id="cloud-confirm" hidden><p id="cloud-confirm-text"></p><button id="cloud-confirm-yes">确认</button><button id="cloud-confirm-no">取消</button></div>
    <details id="cloud-models"><summary>已同步的模型</summary><div></div></details><div class="cloud-profile-footer"><span>配置已加密保护</span><button id="cloud-logout">退出登录</button></div></div><p id="cloud-message" role="status"></p>`;
    const $=(id:string)=>document.getElementById(id)!;
    const input=(name:string)=>document.querySelector(`#cloud-login [name="${name}"]`) as HTMLInputElement;
    let passwordMode=true, cooldown=0, registering=false;
    const switchMode=(password:boolean)=>{passwordMode=password;$('cloud-password-field').hidden=!password;$('cloud-code-field').hidden=password;$('cloud-mode-code').hidden=!password;$('cloud-mode-password').hidden=password;$('cloud-secret-title').textContent=password?'密码':'邮箱验证码';input('password').required=password;input('code').required=!password;$('cloud-message').textContent='';};
    $('cloud-register-toggle').onclick=()=>{registering=!registering;switchMode(true);$('cloud-register-code').hidden=!registering;($('cloud-register-otp') as HTMLInputElement).required=registering;$('cloud-mode-code').hidden=registering;$('cloud-auth-title').textContent=registering?'创建 CShell 账号':'登录 CShell';$('cloud-password-login').textContent=registering?'创建账号 →':'登录 →';$('cloud-switch-description').textContent=registering?'已有账号？':'还没有账号？';$('cloud-register-toggle').textContent=registering?'登录':'创建账号';input('password').minLength=registering?8:0;input('password').autocomplete=registering?'new-password':'current-password';input('password').placeholder=registering?'设置密码，至少 8 个字符':'输入你的密码';input('password').value='';};
    $('cloud-register-send').onclick=()=>{($('cloud-code') as HTMLButtonElement).click();};
    $('cloud-mode-password').onclick=()=>switchMode(true);$('cloud-mode-code').onclick=()=>switchMode(false);
    $('cloud-eye').onclick=()=>{const visible=input('password').type==='password';input('password').type=visible?'text':'password';$('cloud-eye').textContent=visible?'隐藏':'显示';$('cloud-eye').setAttribute('aria-label',visible?'隐藏密码':'显示密码');};
    const digest=async()=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(this.snapshot()))))).map(b=>b.toString(16).padStart(2,'0')).join('');
    const run=async(action:string,args:any={})=>{
      if(this.busy)return;this.busy=true;this.render();
      const before=await digest();root.querySelectorAll('button').forEach(b=>b.disabled=true);
      if(action.includes('login')||action==='register')$('cloud-password-login').textContent='正在登录…';
      try{
        const result=await this.request(action,args);this.state=result.status;this.offline=false;
        if(result.profiles){this.restore(result);this.showModels(result.models);localStorage.setItem('cloud-snapshot-hash',await digest());}
        if(action==='upload')localStorage.setItem('cloud-snapshot-hash',before);
        $('cloud-message').textContent=action==='code'?'验证码已发送，请查收邮件。':'';
        if(action.includes('login')||action==='register'){input('password').value='';($('cloud-key') as HTMLInputElement).value='';}
        if(action==='code'){cooldown=60;const tick=setInterval(()=>{cooldown--;$('cloud-code').textContent=cooldown?cooldown+'s':'发送验证码';($('cloud-code') as HTMLButtonElement).disabled=cooldown>0;($('cloud-register-send') as HTMLButtonElement).disabled=cooldown>0;$('cloud-register-send').textContent=cooldown?cooldown+'s':'发送验证码';if(!cooldown)clearInterval(tick);},1000);}
      }catch(e){
        const raw=(e as Error).message;this.offline=true;
        this.conflict=/冲突|版本.*变化|conflict/i.test(raw);
        if(action.includes('login')||action==='register'){try{this.state=(await this.request('status',{})).status;}catch{}}
        $('cloud-message').textContent=this.state?.email?'':/密码|验证码|频繁|邀请|邮箱|注册/.test(raw)?raw:'暂时无法连接，请检查网络后重试。';
      }finally{this.busy=false;root.querySelectorAll('button').forEach(b=>b.disabled=false);($('cloud-code') as HTMLButtonElement).disabled=cooldown>0;($('cloud-register-send') as HTMLButtonElement).disabled=cooldown>0;$('cloud-register-send').textContent=cooldown?cooldown+'s':'发送验证码';$('cloud-password-login').textContent=registering?'创建账号 →':'登录 →';this.render();}
    };
    $('cloud-login').onsubmit=e=>{e.preventDefault();
      if(registering){
        try{const current=this.snapshot();const profiles=current.profiles.map((raw:any)=>profileSchema.parse({id:raw.id,protocol:raw.protocol==='agent'?'client':'ssh',name:raw.name,host:raw.host,port:Number(raw.port),username:raw.username||'agent',auth:raw.auth,group:raw.group||'',favorite:!!raw.favorite}));
          const bundle={format:1,store:{profiles,groups:[...new Set(profiles.map(p=>p.group).filter(Boolean))],preferences:{...defaults,theme:current.theme},presets:[],monitorViews:[],hosts:{},secrets:{}},ai:{providers:[],extractionProviderId:null,textProviderIds:{translate:null,compose:null}},devices:[],http:[],assets:{}};
          void run('register',{email:input('email').value,code:($('cloud-register-otp') as HTMLInputElement).value,password:input('password').value,bundle});
        }catch{$('cloud-message').textContent='请先补全本机连接信息，再创建账号。';}
      }else void run(passwordMode?'password-login':'login',{email:input('email').value,code:input(passwordMode?'password':'code').value});};
    $('cloud-code').onclick=()=>{if(input('email').reportValidity())void run('code',{email:input('email').value});};
    $('cloud-unlock-button').onclick=()=>void run('password-login',{email:this.state?.email,code:($('cloud-key') as HTMLInputElement).value});
    let direction='';
    const confirm=(action:string)=>{direction=action;$('cloud-confirm').hidden=false;$('cloud-confirm-text').textContent=action==='logout'?'退出后停止此设备的云同步，本机配置保留。':action==='download'?'确认使用云端配置？此设备配置会先备份。':'确认使用此设备配置？';};
    $('cloud-download').onclick=()=>confirm('download');$('cloud-upload').onclick=()=>confirm('upload');$('cloud-logout').onclick=()=>confirm('logout');
    $('cloud-confirm-no').onclick=()=>{$('cloud-confirm').hidden=true;};$('cloud-confirm-yes').onclick=()=>{$('cloud-confirm').hidden=true;this.conflict=false;void run(direction,direction==='upload'?this.snapshot():{});};
    const autoSync=async()=>{if(this.busy||this.conflict)return;if(!this.state)await run('status');if(!this.state?.unlocked)return;const previous=localStorage.getItem('cloud-snapshot-hash');await run(previous&&previous!==await digest()?'upload':previous?'refresh':'download',this.snapshot());};
    void run('status').then(autoSync);setInterval(()=>void autoSync(),15000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)void autoSync();});window.addEventListener('online',()=>void autoSync());
  }
  private request(action: string, args: any): Promise<any> {
    if (!this.native.cloudRequest)
      return Promise.reject(new Error('请更新 Android 应用后使用云同步'));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('云同步超时，请重试；上传请求不会重复写入'));
      }, 45000);
      this.pending.set(id, { resolve, reject, timer });
      this.native.cloudRequest!(JSON.stringify({ request: id, action, ...args }));
    });
  }
  receive(json: string) {
    const value = JSON.parse(json),
      p = this.pending.get(value.request);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(value.request);
    value.error ? p.reject(new Error(value.error)) : p.resolve(value.result);
  }
  private render(){
    const state=this.state;if(!state)return;
    const $=(id:string)=>document.getElementById(id)!;
    const signed=!!state.email;
    $('cloud-auth').hidden=signed;$('cloud-profile').hidden=!signed;
    $('cloud-account').textContent=state.email||'';$('cloud-name').textContent=state.email?.split('@')[0]||'';$('cloud-avatar').textContent=state.email?.slice(0,1).toUpperCase()||'';
    const active=!!state.membership?.active && !!state.membership.expiresAt && state.membership.expiresAt*1000>Date.now();
    $('cloud-membership').hidden=!active;
    $('cloud-plan').textContent=state.membership?active?'Pro 会员':'免费账号':'';
    $('cloud-plan').classList.toggle('cloud-loading',!state.membership);
    $('cloud-expiry-row').hidden=!active;$('cloud-expiry').textContent=active?new Date(state.membership!.expiresAt!*1000).toLocaleDateString():'';
    $('cloud-sync-title').textContent=this.conflict?'有更改需要确认':this.offline?'连接暂时中断':this.busy?'正在同步':state.revision?'所有更改已同步':'正在准备同步';
    $('cloud-sync-state').textContent=this.offline?'更改已保存在本机，将自动重新连接。':state.lastSync?'最近同步于 '+new Date(state.lastSync).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})+' · 自动同步已开启':'登录后自动恢复你的连接与设置';
    $('cloud-sync-dot').classList.toggle('offline',this.offline);
    $('cloud-unlock').hidden=!signed||state.unlocked;$('cloud-conflict').hidden=!this.conflict;
    const entry=$('account-entry');entry.textContent=signed?state.email.split('@')[0]:'登录';
  }
  private showModels(models:{name:string;model:string}[]=[]){
    const container=document.querySelector('#cloud-models>div')!;container.replaceChildren();
    document.querySelector('#cloud-models summary')!.textContent=`已同步 ${models.length} 个模型`;
    for(const model of models){const row=document.createElement('p');row.textContent=model.name+' · '+model.model;container.append(row);}
  }
}
