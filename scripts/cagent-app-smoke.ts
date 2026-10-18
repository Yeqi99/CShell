import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {startCagentApp} from '../src/agent/app';
import {CagentAssistant} from '../src/agent/assistant';
import type {ClientVault} from '../src/core/client/identity';
import type {requestAiReply} from '../src/core/ai-request';
import {randomUUID} from 'node:crypto';
let commands=0,replies=0;const data=new Map();
const vault={read:async(k:string)=>data.get(k),write:async(k:string,v:unknown)=>{data.set(k,structuredClone(v));}} as unknown as ClientVault;
const engine=new CagentAssistant(vault,{shells:async()=>[{shell:'powershell',label:'PowerShell'}],applications:async()=>({applications:[]}),execute:async()=>{commands++;return {stdout:'fixture-only',exitCode:0};},allowed:()=>true},(async()=>++replies===1?{tool_calls:[{id:'1',type:'function',function:{name:'command',arguments:'{"shell":"powershell","command":"Write-Output fixture-only"}'}}]}:{content:'隔离测试已完成。'}) as typeof requestAiReply);
await engine.load();await engine.configure({endpoint:'https://example.invalid/v1/chat/completions',model:'fixture',key:'test-only',commands:true,review:true,delegates:[]});
let plan:any;let packageInstalled=false;let packageGrants:string[]=[];let packageMutations=0;
const packageItem=()=>({id:'cagent.system-apps',name:'系统应用管理',version:'1.0.0',description:'隔离测试能力包',source:'bundled',permissions:['applications.read','applications.plan','applications.install'],installed:packageInstalled,status:packageInstalled?(packageGrants.length?'available':'authorization-required'):'not-installed'});
const app=await startCagentApp('unused',async(method,params:any)=>{
 if(method==='assistant.settings')return engine.snapshot();if(method==='assistant.tasks')return engine.list('local');if(method==='assistant.start')return engine.start(params,'local');if(method==='assistant.task')return engine.get(params,'local');if(method==='assistant.approve')return engine.approve(params);if(method==='assistant.cancel')return engine.cancel(params,'local');
 if(method==='client.status')return {running:false,platform:'win32',deviceId:'fixture-device',fingerprint:'fixture-fingerprint'};
 if(method==='agent.shells')return [{shell:'powershell',label:'PowerShell'}];
 if(method==='applications.policy')return {enabled:false,controllers:[]};
 if(method==='packages.catalog')return [packageItem()];
 if(method==='packages.list')return packageInstalled?[{...packageItem(),requiredPermissions:packageItem().permissions,grants:packageGrants,registered:packageGrants.length>0}]:[];
 if(method==='packages.install'){assert.equal(params.confirm,true);packageInstalled=true;packageMutations++;return packageItem();}
 if(method==='packages.grant'){packageGrants=params.permissions;packageMutations++;return packageItem();}
 if(method==='packages.refresh')return packageItem();
 if(method==='packages.uninstall'){assert.equal(params.confirm,true);packageInstalled=false;packageGrants=[];packageMutations++;return {};}
 if(method==='applications.list')return {platform:'win32',manager:'winget',applications:[{id:'git',package:'Git.Git'},{id:'python',package:'Python.Python.3.12'}]};
 if(method==='applications.plan'){plan={id:randomUUID(),app:params.app,state:'planned',executable:'fixture-winget',args:['install','Git.Git'],warning:'隔离测试计划，不安装真实软件',logs:''};return plan;}
 throw new Error('fixture unsupported '+method);
});
const browser=await chromium.launch({channel:'msedge',headless:true});
try{const page=await browser.newPage({viewport:{width:1200,height:900}});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(app.url);
 await page.getByLabel('任务',{exact:true}).fill('检查当前机器');await page.getByRole('button',{name:'发送',exact:true}).click();
 await page.getByRole('heading',{name:'允许执行这条本机命令？'}).waitFor();assert.equal(commands,0);
 await page.getByRole('button',{name:'允许这一次'}).click();await page.getByText('隔离测试已完成。',{exact:true}).waitFor();assert.equal(commands,1);
 await page.getByLabel('任务',{exact:true}).fill('保留草稿');await page.getByRole('button',{name:'会话、应用与设置',exact:true}).click();await page.getByRole('button',{name:'应用市场',exact:true}).click();
 await page.getByRole('button',{name:'查看配置',exact:true}).click();await page.getByText('未安装',{exact:true}).waitFor();assert.equal(packageMutations,0);
 await page.getByRole('button',{name:'安装并核验能力包',exact:true}).click();await page.getByText('待授权',{exact:true}).waitFor();assert.deepEqual(packageGrants,[]);
 await page.getByLabel('读取系统应用目录',{exact:true}).check();assert.deepEqual(packageGrants,[]);await page.getByRole('button',{name:'保存工具权限',exact:true}).click();await page.getByText('工具已注册',{exact:true}).waitFor();assert.deepEqual(packageGrants,['applications.read']);
 await page.getByRole('button',{name:'停用工具',exact:true}).click();await page.getByText('工具未注册',{exact:true}).waitFor();assert.deepEqual(packageGrants,[]);
 await page.getByRole('button',{name:'卸载能力包',exact:true}).click();assert.equal(packageInstalled,true);await page.getByRole('button',{name:'保留能力包',exact:true}).click();assert.equal(packageInstalled,true);
 await page.getByRole('button',{name:'卸载能力包',exact:true}).click();await page.getByRole('button',{name:'确认卸载',exact:true}).click();await page.locator('#market-list').waitFor();assert.equal(packageInstalled,false);
 await page.getByText('系统应用',{exact:true}).click();await page.getByRole('button',{name:'git · Git.Git',exact:true}).click();await page.getByText('隔离测试计划，不安装真实软件').waitFor();
 await page.getByRole('button',{name:'会话、应用与设置',exact:true}).click();await page.getByRole('button',{name:'智能体',exact:true}).click();assert.equal(await page.getByLabel('任务',{exact:true}).inputValue(),'保留草稿');
 await page.screenshot({path:'test-results/cagent-app.png'});assert.deepEqual(errors,[]);console.log('PASS cagent standalone UI, command review, draft preservation, application plan, CSP');
}finally{await browser.close();await app.close();await engine.close();}
