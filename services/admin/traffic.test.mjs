import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const server = createServer(async (req, res) => {
  if (req.url === '/traffic.js' || req.url === '/styles.css') {
    res.setHeader('Content-Type',req.url.endsWith('.js')?'text/javascript':'text/css');
    res.end(await readFile(new URL('.'+req.url,import.meta.url)));
  } else {res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<link rel="stylesheet" href="/styles.css"><main id="production-traffic"></main><script type="module">import {mountTraffic} from "/traffic.js";mountTraffic(document.querySelector("main"));</script>');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
 const page=await browser.newPage(), requests=[], errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 let drop=true;
 await page.route('**/admin-api/**',async route=>{
  if(route.request().method()==='GET')return route.fulfill({json:{usage:[],reservations:[],limits:[]}});
  requests.push({url:route.request().url(),body:route.request().postDataJSON()});
  if(drop){drop=false;return route.abort('connectionreset');}
  return route.fulfill({json:{ok:true}});
 });
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 const traffic=page.locator('#traffic-change'),storage=page.locator('#storage-change');
 await traffic.locator('select[name=action]').selectOption('grant');
 await traffic.getByLabel('账号 ID',{exact:true}).fill('account-test');
 await traffic.getByLabel('额度 / 扩容量（GiB）').fill('10');
 await traffic.getByLabel('变更原因').fill('Lost response retry');
 await traffic.getByRole('button').click();
 await page.waitForFunction(()=>document.querySelector('#traffic-status').textContent.length>0);
 assert.equal(requests.length,1);
 await page.reload();
 assert.equal(await traffic.getByLabel('变更原因').inputValue(),'Lost response retry');
 await traffic.getByRole('button').click();
 await page.getByText('已保存并记录审计',{exact:true}).waitFor();
 assert.deepEqual(requests[0].body,requests[1].body);
 await traffic.getByLabel('额度 / 扩容量（GiB）').fill('11');
 await traffic.getByRole('button').click();
 await page.waitForFunction(()=>!document.querySelector('#traffic-change button').disabled);
 assert.notEqual(requests[1].body.id,requests[2].body.id);
 assert.equal(requests[2].body.bytes,11*1024**3);
 await storage.getByLabel('同步扩容账号 ID').fill('account-test');
 await storage.getByLabel('增加容量（MiB）').fill('32');
 await storage.getByLabel('到期时间').fill('2027-11-01T12:00');
 await storage.getByLabel('同步扩容原因').fill('Storage upgrade');
 drop=true;await storage.getByRole('button').click();
 await storage.locator('.grant-status').filter({hasText:'Failed'}).waitFor();
 await page.reload();await storage.getByRole('button').click();
 await storage.getByText('已保存并记录审计',{exact:true}).waitFor();
 assert.deepEqual(requests[3],requests[4]);
 assert(requests[4].url.endsWith('/storage-grant'));
 assert.equal(requests[4].body.bytes,32*1024**2);
 assert.equal(requests[4].body.expiresAt,new Date('2027-11-01T12:00').getTime()/1000);
 for(const width of [1200,760,390]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
 assert.deepEqual(errors,[]);
 console.log('PASS traffic/storage response-loss idempotency, remount drafts, changed payload IDs, MiB/expiry and responsive UI');
} finally {await browser.close();server.close();}
