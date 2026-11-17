import {_electron as electron} from 'playwright';
import {mkdtemp,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {createServer as createHttpServer} from 'node:http';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {createAgentRuntime} from '../src/agent/runtime';
const data=await mkdtemp(join(tmpdir(),'cagent-conversation-'));
const runtime=await createAgentRuntime({directory:join(data,'agent')});
const holder=createServer().listen(0,'127.0.0.1');await once(holder,'listening');
const port=(holder.address() as any).port;await new Promise<void>(resolve=>holder.close(()=>resolve()));
await runtime.dispatch('connection.save',{bind:'127.0.0.1',port,password:'fixture-password'});
let finishModel: (()=>void)|undefined;
const modelServer=createHttpServer(async(req,res)=>{
 for await(const _ of req){}
 res.writeHead(200,{'Content-Type':'text/event-stream'});
 res.write('data: '+JSON.stringify({choices:[{index:0,delta:{content:'<think>PRIVATE_REASONING</think>左侧正在逐步回复'}}]})+'\n\n');
 finishModel=()=>res.end('data: '+JSON.stringify({choices:[{index:0,delta:{content:'，测试完成。'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
});
await new Promise<void>(resolve=>modelServer.listen(0,'127.0.0.1',resolve));
await runtime.dispatch('assistant.configure',{endpoint:'http://127.0.0.1:'+(modelServer.address() as any).port+'/v1',model:'Shared model',key:'fixture',commands:false,review:true,delegates:['*']});
const env={...process.env,CSHELL_TEST_DATA:join(data,'cshell'),CSHELL_TEST_START_GATE:'1'};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({args:process.env.CSHELL_EXECUTABLE?[]:['.'],executablePath:process.env.CSHELL_EXECUTABLE,env});
await app.evaluate(()=>{(globalThis as any).__cshellPackagedTestAttached=true;});
await mkdir('test-results',{recursive:true});
try{
 const page=await app.firstWindow();page.setDefaultTimeout(20000);
 await page.getByRole('heading',{name:'工作台',exact:true}).waitFor();
 await page.evaluate(async port=>{
  const info=await window.cshell.clientProbe({host:'127.0.0.1',port});
  const device=await window.cshell.clientPasswordPair(info,'fixture-password');
  await window.cshell.saveProfile({id:device.deviceId,protocol:'client',name:'知识库验证机器',host:device.host,port:device.port,username:'Client',auth:'password',favorite:false,group:''});
 },port);
 await page.reload();await page.getByText('知识库验证机器',{exact:true}).first().dblclick();

 await page.locator('[data-desktop-icon=applications]').last().dblclick();
 const market=page.locator('.agent-applications:visible');await market.waitFor();
 assert.equal(await market.getByRole('textbox').count(),1);
 assert.equal(await market.getByRole('heading',{name:'开发工具',exact:true}).count(),0);
 await market.getByRole('navigation',{name:'应用分类'}).getByRole('button',{name:'智能体应用'}).click();
 await market.locator('.agent-app-grid:visible button').first().waitFor();
 await market.getByRole('textbox',{name:'搜索应用市场'}).fill('知识');
 assert((await market.locator('.agent-app-grid:visible').innerText()).includes('知识'));
 await market.getByRole('textbox',{name:'搜索应用市场'}).fill('');
 await market.locator('.agent-app-grid:visible button').first().click();
 await market.locator('.capability-detail:visible').waitFor();
 await market.getByRole('button',{name:'数据库与环境',exact:true}).click();
 await market.getByRole('button',{name:'智能体应用',exact:true}).click();
 await market.locator('.capability-detail:visible').waitFor();
 await market.getByRole('button',{name:'返回能力包列表'}).click();
 await page.screenshot({path:'test-results/market-unified.png'});
 for(const category of ['开发工具','数据库与环境','智能体应用']){
   await market.getByRole('navigation',{name:'应用分类'}).getByRole('button',{name:category,exact:true}).click();
   assert.equal(await market.evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
 }
 await market.evaluate(el=>{(el as HTMLElement).style.width='340px';});
 assert.equal(await market.evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
 await page.screenshot({path:'test-results/market-unified-narrow.png'});

 console.log('PASS unified marketplace, single search, categories, search filtering, detail preserved across categories, narrow layout');
}catch(error){await (await app.firstWindow()).screenshot({path:'test-results/cagent-conversation-failure.png'});throw error;}
finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});finishModel?.();modelServer.closeAllConnections();modelServer.close();await runtime.close();}
