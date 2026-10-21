import {chromium} from 'playwright';
import {readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
  const page=await browser.newPage({viewport:{width:393,height:852},isMobile:true,hasTouch:true});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin!=='https://fixture.invalid')return route.abort();
    const name=url.pathname==='/'?'index.html':url.pathname.slice(1);
    if(!['index.html','app.js','app.css','icon.png'].includes(name))return route.abort();
    await route.fulfill({contentType:name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':name.endsWith('.png')?'image/png':'text/html',body:await readFile('android/app/src/main/assets/'+name)});
  });
  await page.addInitScript(()=>{
    let logged=false,unlocked=false;
    (window as any).CShellNative={version:()=> '0.8.1-test',agentSupported:()=>true,setTheme:()=>{},localFilesStatus:()=> '{}',cagentStatus:()=> '{}',
      cloudRequest:(json:string)=>{const p=JSON.parse(json);if(p.action==='login')logged=true;if(p.action==='unlock')unlocked=true;
        const result:any={status:{email:logged?'test@example.com':'',unlocked,revision:logged?1:0}};
        if(p.action==='download')Object.assign(result,{profiles:[{id:'11111111-1111-4111-8111-111111111111',protocol:'ssh',name:'同步的服务器',host:'example.com',port:'22',username:'user',auth:'password',group:'',favorite:false}],theme:'dark',models:[{name:'已配置基座',model:'configured-model'}]});
        setTimeout(()=>window.receive('','cloud-result',JSON.stringify({request:p.request,result})),0);
      }};
  });
  await page.goto('https://fixture.invalid/');
  await page.locator('#navigation [data-page=settings]').click();
  await page.locator('#cloud-message').getByText('操作完成').waitFor();
  await page.getByLabel('邮箱',{exact:true}).fill('test@example.com');await page.getByLabel('验证码',{exact:true}).fill('123456');
  await page.getByRole('button',{name:'注册 / 登录',exact:true}).click();
  await page.getByLabel('恢复密钥',{exact:true}).fill('test-only-key');await page.getByRole('button',{name:'解锁',exact:true}).click();
  await page.getByRole('button',{name:'恢复云端到本机',exact:true}).click();await page.locator('#cloud-confirm-no').click();
  assert.equal(await page.evaluate(()=>localStorage.getItem('profiles')),null);
  await page.getByRole('button',{name:'恢复云端到本机',exact:true}).click();await page.locator('#cloud-confirm-yes').click();
  await page.getByText('已配置基座 · configured-model',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('profiles')!)[0].name),'同步的服务器');
  assert.equal(await page.evaluate(()=>localStorage.getItem('theme')),'dark');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/cloud-android.png',fullPage:true});
  assert.deepEqual(errors,[]);console.log('PASS: full Android web shell login/unlock/restore, cancellation, theme and model descriptors; no external requests');
}finally{await browser.close();}
