import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const server=createServer(async(req,res)=>{
  const path=req.url==='/app.js'?'app.js':req.url==='/styles.css'?'styles.css':req.url==='/icon.svg'?'icon.svg':'index.html';
  res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.svg')?'image/svg+xml':'text/html; charset=utf-8');
  res.end(await readFile('services/admin/'+path));
});
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'msedge'});
try{
  const page=await browser.newPage();let revoked=false,payload:unknown;
  await page.route('**/admin-api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    let response:unknown={};
    if(path.endsWith('/accounts'))response={accounts:[{id:'owner',email:'owner@example.test',revision:2,membership:{active:true}}],audit:[]};
    else if(path.endsWith('/model-usage'))response={usage:[],recent:[]};
    else if(path.endsWith('/lending/revoke')){payload=route.request().postDataJSON();revoked=true;response={revoked:true};}
    else if(path.endsWith('/lending'))response={loans:[{id:'loan-1',owner:'owner',deviceIds:['device-1'],email:null,maxUses:2,expiresAt:Math.floor(Date.now()/1000)+86400,revoked}]};
    await route.fulfill({json:response});
  });
  await page.goto('http://127.0.0.1:'+(server.address() as any).port+'/#accounts');
  await page.getByRole('button',{name:'撤销授权',exact:true}).waitFor();
  await mkdir('test-results/admin',{recursive:true});
  for(const width of [1200,760,390]){
    await page.setViewportSize({width,height:900});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.screenshot({path:`test-results/admin/lending-${width}.png`,fullPage:true});
  }
  await page.getByRole('button',{name:'撤销授权',exact:true}).click();
  await page.getByLabel('撤销原因').fill('用户要求收回');
  await page.getByRole('button',{name:'确认撤销',exact:true}).click();
  await page.getByText('已撤销',{exact:true}).waitFor();
  assert.deepEqual(payload,{id:'loan-1',reason:'用户要求收回'});
  await page.goto('http://127.0.0.1:'+(server.address() as any).port+'/#settings');
  await page.getByText('生产服务已连接',{exact:true}).waitFor();
  assert.equal(await page.getByText('本页不能修改生产账号',{exact:false}).count(),0);
  assert.equal(await page.locator('.settings-row').filter({hasText:'机器借用授权'}).getByText('已连接',{exact:true}).count(),1);
  assert.equal(await page.locator('.settings-row').filter({hasText:'支付与点数'}).getByText('本地草稿',{exact:true}).count(),1);
  for(const width of [1200,390]){
    await page.setViewportSize({width,height:900});
    if(width<650)await page.waitForFunction(()=>document.querySelector('.sidebar')!.getBoundingClientRect().right<=1);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.screenshot({path:`test-results/admin/settings-${width}.png`,fullPage:true});
  }
  console.log('PASS admin lending responsive list and explicit audited revocation');
}finally{await browser.close();server.close();}
