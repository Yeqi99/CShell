import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const server=createServer(async(req,res)=>{const path=['/app.js','/feedback.js','/styles.css','/icon.svg'].includes(req.url||'')?req.url!.slice(1):'index.html';res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(await readFile('services/admin/'+path));});
await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'msedge'});
try{
 const page=await browser.newPage();let payload:any,status='new';
 await page.route('**/admin-api/**',async route=>{const path=new URL(route.request().url()).pathname;let data:any={accounts:[],audit:[],usage:[],recent:[],loans:[]};
 if(path.endsWith('/feedback/status')){payload=route.request().postDataJSON();status=payload.status;data={id:'report-1',status};}
 else if(path.endsWith('/feedback'))data={reports:[{id:'report-1',message:'<img src=x onerror=alert(1)> broken install',diagnostic:'diagnostic text',version:'1.0.0',platform:'win32',createdAt:1700000000,status}]};
 await route.fulfill({json:data});});
 await page.goto('http://127.0.0.1:'+(server.address() as any).port+'/#feedback');
 await page.getByRole('button',{name:'查看详情'}).waitFor();
 await page.getByRole('button',{name:'查看详情'}).click();
 assert.equal(await page.locator('#production-feedback img').count(),0);
 for(const width of [1200,760,390]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
 await page.getByLabel('处理状态').selectOption('investigating');await page.getByLabel('处理说明').fill('正在复现安装问题');
 await page.getByRole('button',{name:'保存处理结果'}).click();await page.getByText('处理状态已保存',{exact:true}).waitFor();
 assert.deepEqual(payload,{id:'report-1',previousStatus:'new',status:'investigating',reason:'正在复现安装问题'});
 console.log('PASS feedback live API, escaped detail, responsive layout and status action');
}finally{await browser.close();server.close();}
