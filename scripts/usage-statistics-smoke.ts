import {_electron as electron} from 'playwright';
import {mkdtemp,readFile,mkdir} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import assert from 'node:assert/strict';
const data=await mkdtemp(join(tmpdir(),'cshell-usage-test-'));const app=await electron.launch({args:['.'],env:{...process.env,CSHELL_TEST_DATA:data}});
try {
 await app.evaluate(({net})=>{const original=net.fetch.bind(net);(globalThis as any).usageCalls=[];net.fetch=(async(url:any,options:any)=>{if(String(url).includes('/v1/public/usage')){(globalThis as any).usageCalls.push({url:String(url),body:options?.body});return new Response(JSON.stringify(String(url).endsWith('usage-device')?{ok:true}:{registeredAccounts:24,activeAccounts:7,participatingDevices30d:5,activeDevices:2,windowSeconds:300,sampledAt:Math.floor(Date.now()/1000)}),{status:200,headers:{'Content-Type':'application/json'}});}return original(url,options);}) as any;});
 const page=await app.firstWindow();await page.getByRole('heading',{name:'工作台',exact:true}).waitFor();await page.getByRole('button',{name:'偏好设置',exact:true}).click();await page.locator('.settings-nav').getByRole('button',{name:'关于与更新',exact:true}).click();
 const check=page.getByRole('checkbox',{name:'自愿参与匿名设备统计',exact:true});await check.waitFor();assert.equal(await page.getByText('注册账号',{exact:true}).count(),0);assert.equal(await check.isChecked(),false);
 assert.equal(await app.evaluate(()=> (globalThis as any).usageCalls.filter((x:any)=>x.body).length),0);
 await check.check();await page.waitForFunction(()=>!document.querySelector<HTMLInputElement>('.usage-consent input')?.disabled);await page.waitForTimeout(150);
 let state=JSON.parse(await readFile(join(data,'usage-consent.json'),'utf8'));assert.equal(state.enabled,true);assert.match(state.token,/^[a-f0-9]{64}$/);
 await check.uncheck();await page.waitForFunction(()=>!document.querySelector<HTMLInputElement>('.usage-consent input')?.disabled);await page.waitForTimeout(150);
 const calls=await app.evaluate(()=> (globalThis as any).usageCalls.filter((x:any)=>x.body).map((x:any)=>JSON.parse(x.body)));
 assert.deepEqual(calls.map((x:any)=>x.enabled),[true,false]);assert.equal(calls[0].token,calls[1].token);
 for(let i=0;i<30;i++){state=JSON.parse(await readFile(join(data,'usage-consent.json'),'utf8'));if(!state.token)break;await page.waitForTimeout(100);}assert.equal(state.enabled,false);assert.equal(state.token,'');
 await page.setViewportSize({width:1050,height:850});await page.locator('.usage-consent').scrollIntoViewIfNeeded();await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/usage-statistics.png'});console.log('PASS default-off, explicit opt-in, deduplicated token, opt-out deletion, persisted local setting');
}finally{await app.close();}
