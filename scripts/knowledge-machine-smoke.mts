import {_electron as electron} from 'playwright';
import {mkdtemp} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomUUID} from 'node:crypto';
import {createServer} from 'node:net';import {once} from 'node:events';
import {createAgentRuntime} from '../src/agent/runtime';
const data=await mkdtemp(join(tmpdir(),'kb-machine-')),runtime=await createAgentRuntime({directory:join(data,'agent')});
const listener=createServer().listen(0,'127.0.0.1');await once(listener,'listening');const port=(listener.address() as any).port;await new Promise(r=>listener.close(r));const password=randomUUID();
await runtime.dispatch('connection.save',{bind:'127.0.0.1',port,password});
const env={...process.env,CSHELL_TEST_DATA:join(data,'cshell')};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({args:['.'],env});const page=await app.firstWindow();page.setDefaultTimeout(12000);
try{
await page.waitForFunction(()=>!!window.cshell);
await page.evaluate(async({port,password})=>{const info=await window.cshell.clientProbe({host:'127.0.0.1',port});const device=await window.cshell.clientPasswordPair(info,password);await window.cshell.saveProfile({id:device.deviceId,protocol:'client',name:'知识库验收',host:device.host,port:device.port,username:'Client',auth:'password',favorite:false,group:''});},{port,password});await page.reload();
await page.getByText('知识库验收',{exact:true}).first().dblclick();
await page.getByText('应用市场',{exact:true}).last().dblclick();
await page.getByText('机器知识库',{exact:true}).first().click();
await page.getByRole('button',{name:'安装并核验能力包'}).click();
await page.getByRole('button',{name:'打开知识库'}).click();
const kb=page.locator('.machine-knowledge:visible');
await kb.getByLabel('标题').fill('人工输入验收');await kb.getByLabel('正文').fill('检索内容');await kb.getByText('保存知识',{exact:true}).click();await kb.getByText('已保存',{exact:true}).waitFor();await kb.getByText('查询记录',{exact:true}).click();await kb.getByRole('button',{name:/人工输入验收/}).click();await kb.locator('pre').getByText('检索内容').waitFor();
const box=kb.getByLabel(/为智能体提供知识支持/);await box.click();await kb.getByText('智能体权限已保存').waitFor();
const tools=await runtime.dispatch('packages.tools',{}) as any[];if(!tools.some(t=>t.id==='knowledge_search')||tools.some(t=>t.id==='knowledge_put'))throw Error('grant mismatch');
await box.click();await kb.getByText('智能体权限已保存').waitFor();if((await runtime.dispatch('packages.tools',{}) as any[]).some(t=>t.packageId==='cagent.knowledge'))throw Error('revoke failed');
console.log('PASS connected desktop install/manual/grant/revoke');
} catch(error){console.log((await page.locator('body').innerText()).slice(-2400));throw error;}finally{await app.close();await runtime.close();}

