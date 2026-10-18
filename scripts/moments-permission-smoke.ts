import {_electron as electron} from 'playwright';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const data=await mkdtemp(join(tmpdir(),'cshell-permission-links-'));
let toolObserved=false;
const server=createServer(async(req,res)=>{
 let body='';for await(const chunk of req)body+=chunk;
 const request=JSON.parse(body);toolObserved=request.tools.some((t:any)=>t.function.name==='get_permission_link');
 const message=request.messages.at(-1).role==='tool'
 ? {role:'assistant',content:JSON.parse(request.messages.at(-1).content).markdown+'\n\n[智能体微信读取权限](#cshell-permission/application/wechat.read)'}
 : {role:'assistant',content:null,tool_calls:[{id:'link_test',type:'function',function:{name:'get_permission_link',arguments:JSON.stringify({node:'wechat/readMoments'})}}]};
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message}]}));
});
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
const env={...process.env,CSHELL_TEST_DATA:data};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({args:['.'],env});
try{
 const page=await app.firstWindow();page.setDefaultTimeout(20000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.getByRole('heading',{name:'尚未连接'}).waitFor();
 await page.evaluate(async({id,url})=>{await window.cshell.pluginInstall('cshell.wechat');await window.cshell.aiProviderSave({id,name:'Link test',url,model:'test'},'');},{id:randomUUID(),url:`http://127.0.0.1:${(server.address() as any).port}/v1`});
 await page.reload();await page.getByRole('button',{name:'AI 智能体',exact:true}).click();
 const composer=page.getByLabel('发送给智能体');await composer.fill('定位缺少的权限');await composer.press('Enter');
 const link=page.getByRole('link',{name:'前往授权：微信：读取朋友圈缓存',exact:true});await link.waitFor();assert(toolObserved);
 await composer.fill('保留聊天草稿');await link.click();
 const node=page.locator('[data-permission-node="wechat/readMoments"]');await node.waitFor();
 await page.waitForFunction(()=>document.activeElement===document.querySelector('[data-permission-node="wechat/readMoments"] input'));
 assert.equal(await node.locator('input').isChecked(),false);assert.equal((await page.evaluate(()=>window.cshell.wechatStatus())).config.readMoments,false);
 await page.getByLabel('微信发送授权').fill('filehelper');
 await link.click();assert.equal(await page.getByLabel('微信发送授权').inputValue(),'filehelper');assert.equal(await composer.inputValue(),'保留聊天草稿');
 await page.getByRole('link',{name:'智能体微信读取权限',exact:true}).click();
 const appNode=page.locator('[data-permission-node="application/wechat.read"]');await appNode.waitFor();
 await page.waitForFunction(()=>document.activeElement===document.querySelector('[data-permission-node="application/wechat.read"] input'));
 assert.equal(await appNode.locator('input').isChecked(),false);assert.deepEqual((await page.evaluate(()=>window.cshell.aiSnapshot())).policy.application,[]);
 assert.deepEqual(errors,[]);await page.screenshot({path:'test-results/moments-permission.png'});
 console.log('PASS: model tool available without permissions; Markdown click opens exact nodes; focus; drafts preserved; no grants changed');
}finally{await app.close();server.close();await rm(data,{recursive:true,force:true});}
