import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
const dir=new URL('./',import.meta.url);
const server=createServer(async(req,res)=>{
 const path=req.url.split('?')[0].slice(1)||'index.html';
 if(!/^[\w.-]+$/.test(path)){res.writeHead(404);return res.end();}
 try{res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html;charset=utf-8');res.end(await readFile(new URL(path,dir)));}catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'msedge'});
try{
 const page=await browser.newPage(),errors=[],writes=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/admin-api/**',async route=>{
 const path=route.request().url().split('/').at(-1),post=route.request().method()==='POST';
 if(post)writes.push(route.request().postDataJSON());
 const values={'accounts':{accounts:[],audit:[]},'model-usage':{usage:[],recent:[]},lending:{loans:[]},'model-pool':{members:100,weeklyYuan:5,inventory:{byProvider:{deepseek:'48.92','opencode-go':'70'},knownRemainingYuan:'48.92',knownTotalYuan:null,units:[{provider:'deepseek',unit:'CNY',remaining:'48.92',total:null}],excluded:{}},pools:['qwen','mimo','deepseek','qwen-plan','opencode-go'].map(provider=>({provider,capacity:1000,weekly:10,keys:[],plans:[],models:[],calls:{}}))}};
 return route.fulfill({json:post?{ok:true}:values[path]||{}});
 });
 await page.goto('http://127.0.0.1:'+server.address().port);
 await page.getByRole('heading',{name:'运营概览'}).waitFor();
 await page.getByRole('button',{name:'管理号池',exact:true}).click();
 await page.getByRole('button',{name:'DeepSeek',exact:true}).click();
 await page.getByText('¥48.92',{exact:true}).waitFor();
 await page.getByRole('button',{name:'百炼 Token Plan',exact:true}).click();
 const inventory=page.locator('[data-inventory]');
 await inventory.getByRole('heading',{name:'百炼 Token Plan · 供应商库存'}).waitFor();
 assert(!/DeepSeek|OpenCode|48.92/.test(await inventory.innerText()));
 await page.getByRole('button',{name:'OpenCode Go',exact:true}).click();
 await inventory.getByText('¥70',{exact:true}).waitFor();
 await page.getByRole('button',{name:'DeepSeek',exact:true}).click();
 await page.locator('input[name=tokens]').fill('100');await page.getByRole('button',{name:'保存计量设置'}).click();
 await page.getByText('已保存',{exact:true}).waitFor();
 assert.equal(writes[0].provider,'deepseek');assert.equal(writes[0].tokens,'100');assert.deepEqual(errors,[]);
}finally{await browser.close();server.close();}
