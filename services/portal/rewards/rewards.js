import {drawPoster} from './poster.js';
const el=id=>document.getElementById(id);
const params=new URLSearchParams(location.hash.slice(1));
const invite=params.get('invite')||'',gift=params.get('gift')||'';
let registering=!!invite, token='',mine='';
const auth=el('auth'),redeem=el('redeem'),canvas=document.querySelector('canvas');
async function api(path,body){
 const res=await fetch('/api/v1/'+path,{method:body?'POST':'GET',cache:'no-store',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});
 const data=await res.json();if(!res.ok)throw Error(data.error||'请求失败');return data;
}
const b64=a=>btoa(String.fromCharCode(...new Uint8Array(a)));
async function registration(email,password,code){
 const accountId=crypto.randomUUID().replaceAll('-',''),salt=crypto.getRandomValues(new Uint8Array(32)),raw=crypto.getRandomValues(new Uint8Array(32)),enc=new TextEncoder();
 const secret=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveKey']);
 const wrappingKey=await crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:210000,hash:'SHA-256'},secret,{name:'AES-GCM',length:256},false,['encrypt']);
 async function seal(key,data){const iv=crypto.getRandomValues(new Uint8Array(12));return {format:1,nonce:b64(iv),ciphertext:b64(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode('cshell-sync:1:'+accountId)},key,enc.encode(JSON.stringify(data))))};}
 const empty=await (await fetch('empty-vault.json')).json();
 const key=b64(raw).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
 return api('auth/register',{email,password,code,accountId,invite,keybox:{salt:b64(salt),envelope:await seal(wrappingKey,{key})},envelope:await seal(await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt']),empty)});
}
let posterSequence=0;
async function poster(type,code,label){
 const sequence=++posterSequence;el('save').hidden=true;el('save').disabled=true;el('status').textContent='正在生成高清海报…';
 try{const draft=document.createElement('canvas');await drawPoster(draft,{type,code,label});if(sequence!==posterSequence)return;canvas.width=draft.width;canvas.height=draft.height;canvas.getContext('2d').drawImage(draft,0,0);canvas.hidden=false;el('save').hidden=false;el('save').disabled=false;el('status').textContent='海报已生成，可保存图片。';}
 catch(error){if(sequence===posterSequence)el('status').textContent=error.message;}
}

function mode(){el('codeRow').hidden=!registering;auth.elements.code.required=registering;el('submit').textContent=registering?'注册':'登录';el('toggle').textContent=registering?'已有账号，去登录':'注册账号';auth.elements.password.autocomplete=registering?'new-password':'current-password';}
function run(button,work){return async e=>{e.preventDefault();button.disabled=true;el('status').textContent='';try{await work();}catch(error){el('status').textContent=error.message;}finally{button.disabled=false;}};}
async function refresh(){
 const sales=await api('account/plan-offers');
 el('offers').replaceChildren(...sales.offers.map(o=>{const b=document.createElement('button');const request=crypto.randomUUID();b.textContent='购买 '+o.plan+' · '+o.days+' 天 · '+o.price+' 点';b.onclick=run(b,async()=>{await api('account/plan-offers',{...o,request});el('status').textContent='已开通 '+o.plan;await refresh();});return b;}));
 const data=await api('account/rewards');mine=data.invite;el('stats').textContent='已邀请 '+data.invited+' 人 · 累计奖励 '+data.earned+' 点';
 el('ledger').replaceChildren(...data.ledger.map(row=>{const li=document.createElement('li');li.textContent=(row.points>0?'+':'')+row.points+' 点 · '+row.reference;const b=document.createElement('button');b.textContent='来源';b.onclick=run(b,async()=>{const r=await api('account/points-trace',{reference:row.reference});el('status').textContent=r.entries.map(l=>l.points+' 点 · '+l.reference).join('　');});li.append(' ',b);return li;}));
}
el('save').onclick=()=>canvas.toBlob(blob=>{if(!blob)return;const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=gift?'CShell-礼品卡.png':'CShell-邀请海报.png';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),3000);});
el('toggle').onclick=()=>{registering=!registering;mode();};
el('send').onclick=run(el('send'),async()=>{if(!auth.elements.email.reportValidity())return;await api('auth/code',{email:auth.elements.email.value});el('status').textContent='验证码已发送';});
auth.onsubmit=run(el('submit'),async()=>{const {email,password,code}=Object.fromEntries(new FormData(auth));const result=registering?await registration(email,password,code):await api('auth/password-login',{email,password});token=result.token;auth.reset();el('identity').textContent=email;auth.hidden=true;el('account').hidden=false;await refresh();if(!gift)poster('invite',mine,'好友充值后，你可获 5% 点数奖励');});
redeem.onsubmit=run(redeem.querySelector('button'),async()=>{const result=await api('account/redeem',{code:redeem.elements.code.value.trim()});el('status').textContent=result.kind==='points'?'已领取 '+result.quantity+' 点':result.kind==='membership'?'已领取 '+result.plan+' '+result.quantity+' 天':'本周额度已重置';await refresh();});
el('mine').onclick=()=>poster('invite',mine,'好友充值后，你可获 5% 点数奖励');
el('logout').onclick=()=>location.reload();
mode();
if(gift){el('title').textContent='领取礼品卡';el('intro').textContent='登录或注册后，确认兑换到当前账号。';redeem.elements.code.value=gift;if(params.get('poster'))poster('gift',gift,params.get('poster').slice(0,80));}
else if(invite && params.get('preview')==='1'){el('title').textContent='我的邀请海报';el('intro').textContent='保存图片后即可分享。';poster('invite',invite,'好友充值后，你可获 5% 点数奖励');document.querySelector('.panel').hidden=true;}
else if(invite){el('title').textContent='好友邀请你加入 CShell';el('intro').textContent='注册后，你的充值会为邀请人带来 5% 点数奖励。';}
else{el('intro').textContent='生成个人邀请海报，或输入兑换码领取奖励。';}
