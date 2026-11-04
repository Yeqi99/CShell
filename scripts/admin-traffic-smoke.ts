import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const server=createServer(async(req,res)=>{const path=['/app.js','/feedback.js','/traffic.js','/styles.css','/icon.svg'].includes(req.url||'')?req.url!.slice(1):'index.html';res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(await readFile('services/admin/'+path));});
await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));let payload:any;
 await page.route('**/admin-api/**',async route=>{if(route.request().method()==='POST'){payload=route.request().postDataJSON();await route.fulfill({json:{ok:true}});}else await route.fulfill({json:{usage:[{email:'<script>bad</script>',period:'2026-11',category:'relay',ingressBytes:1024,egressBytes:2048,cost:null}],reservations:[],limits:[]}});});
 await page.goto('http://127.0.0.1:'+(server.address() as any).port+'/#traffic');
 await page.getByRole('heading',{name:'实际用量'}).waitFor();assert.equal(await page.locator('#production-traffic script').count(),0);
 for(const width of [1200,760,390]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
 await page.getByLabel('账号 ID').fill('account-test');await page.getByLabel('额度 / 扩容量（GiB）').fill('10');await page.getByLabel('变更原因').fill('test allowance');await page.getByRole('button',{name:'保存配置'}).click();await page.getByText('已保存并记录审计',{exact:true}).waitFor();assert.equal(payload.bytes,10*1024**3);assert.deepEqual(errors,[]);console.log('PASS traffic management layout, escaped data and real request shape');
}finally{await browser.close();server.close();}
