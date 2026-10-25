import {_electron as electron} from 'playwright';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import assert from 'node:assert/strict';import {fixture} from '../tests/fixture';
const server=await fixture(),data=await mkdtemp(join(tmpdir(),'files-reopen-'));
await mkdir(join(server.root,'projects'));await writeFile(join(server.root,'projects','keep.txt'),'fixture');
const app=await electron.launch({args:['.'],env:{...process.env,CSHELL_TEST_DATA:data}});
try{await app.evaluate(({dialog})=>{dialog.showMessageBox=(async()=>({response:1,checkboxChecked:false})) as typeof dialog.showMessageBox;});const page=await app.firstWindow();await page.getByRole('button',{name:'新建连接',exact:true}).first().click();await page.getByRole('button',{name:'SSH 终端',exact:true}).click();const form=page.locator('.connection-editor:visible');await form.getByLabel('保存到服务器列表').uncheck();await form.getByLabel('主机地址').fill('127.0.0.1');await form.getByLabel('端口',{exact:true}).fill(String(server.port));await form.getByLabel('用户名',{exact:true}).fill('tester');await form.locator('.connection-secret input').fill(server.password);await form.getByRole('button',{name:'连接',exact:true}).click();const panel=page.locator('.tools-panel:visible');await panel.getByText('Test CPU Model',{exact:true}).waitFor();
const categories=panel.getByRole('group',{name:'机器信息分类'});
assert.equal(await categories.getByRole('button').count(),6);
for (const name of ['内存','硬盘','GPU','进程','网络','CPU']) {
 await categories.getByRole('button',{name,exact:true}).click();
 assert.equal(await categories.getByRole('button',{name,exact:true}).getAttribute('aria-pressed'),'true');
 assert.equal(await panel.locator('.resource-cpu-model').isVisible(),name==='CPU');
 assert.equal(await panel.locator('.metric-latency').isVisible(),name==='网络');
 assert.equal(await panel.locator('.gpu-inventory').isVisible(),name==='GPU');
 assert.equal(await panel.locator('.process-content').isVisible(),name==='进程');
}
await page.setViewportSize({width:1000,height:800});
await panel.getByText('Test CPU Model',{exact:true}).waitFor();
assert(await categories.evaluate(el=>el.scrollWidth<=el.clientWidth));
await page.screenshot({path:'test-results/ssh-resource-categories.png'});
console.log('PASS six categories, visible CPU model, isolated content, narrow dock');
}finally{await app.close();await server.close();}
