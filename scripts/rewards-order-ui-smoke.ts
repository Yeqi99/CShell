import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';

const server=createServer(async(req,res)=>{
 const path=new URL(req.url!,'http://localhost').pathname.slice(1)||'index.html';
 try{
   res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html; charset=utf-8');
   res.end(await readFile('services/admin/'+path));
 }catch{res.writeHead(404).end();}
});
await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
const browser=await chromium.launch({channel:'msedge'});
try{
 const page=await browser.newPage();
 const calls:Record<string,any>[]=[];
 await page.route('**/admin-api/**',async route=>{
   const path=new URL(route.request().url()).pathname.split('/').pop();
   let json:any={accounts:[],plans:[{name:'Pro'}],offers:[],entries:[],audit:[],usage:[],recent:[],loans:[]};
   if(path==='gift-cards'){
     const data=route.request().postDataJSON();calls.push(data);
     if(calls.length===1){await route.fulfill({status:503,json:{error:'fixture offline'}});return;}
     json={...data,code:'CODE'+calls.length};
   }
   await route.fulfill({json});
 });
 await page.goto('http://127.0.0.1:'+(server.address() as any).port+'/#rewards');
 const gift=page.locator('#reward-panel-0');
 await gift.locator('select[name=plan] option').first().waitFor({state:'attached'});
 await gift.getByLabel('销售单号').fill('ORDER-1');
 await gift.getByLabel('可领取人数').fill('3');
 await gift.getByLabel('每人点数').fill('100');
 assert.match(await gift.innerText(),/3 人可领，每人 100 点，最多发放 300 点/);
 await page.getByRole('button',{name:'充值入账',exact:true}).click();
 await page.locator('#settle [name=order]').fill('PAY-DRAFT');
 await page.getByRole('button',{name:'发礼品卡',exact:true}).click();
 assert.equal(await gift.getByLabel('销售单号').inputValue(),'ORDER-1');
 const submit=gift.getByRole('button',{name:'生成礼品卡'});
 await submit.click();await gift.locator('[role=status]').filter({hasText:/./}).waitFor();
 await submit.click();await gift.getByText('登记下一单').waitFor();
 assert.equal(calls[0].request,calls[1].request);
 assert.ok(await submit.isDisabled());
 await gift.getByText('登记下一单').click();
 await gift.getByLabel('销售单号').fill('ORDER-2');
 await gift.getByLabel('奖励类型').selectOption('membership');
 await gift.getByLabel('每人会员天数').fill('7');
 await submit.click();await gift.getByText('登记下一单').waitFor();
 assert.notEqual(calls[1].request,calls[2].request);
 await gift.getByText('本页已生成的礼品卡').click();
 assert.equal(await gift.locator('details a').count(),2);
 assert.match(await gift.locator('details a').last().getAttribute('href')||'',/CODE2/);
 await page.getByRole('button',{name:'充值入账',exact:true}).click();
 assert.equal(await page.locator('#settle [name=order]').inputValue(),'PAY-DRAFT');
 for(const width of [390,760,1920]){await page.setViewportSize({width,height:850});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
 console.log('PASS: gift preview, retry identity, two orders, previous link, tab drafts and responsive widths');
}finally{await browser.close();server.close();}
