import {_electron as electron} from 'playwright';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const data=await mkdtemp(join(tmpdir(),'cshell-wechat-ui-'));
const env={...process.env,CSHELL_TEST_DATA:data};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({args:['.'],env});
try{
 const page=await app.firstWindow();page.setDefaultTimeout(15000);
 await page.getByRole('button',{name:'插件与应用',exact:true}).click();
 const card=page.locator('[data-provider="wechat"]');
 await card.getByRole('button',{name:'安装',exact:true}).click();
 await card.getByRole('button',{name:'打开插件',exact:true}).click();
 await page.getByLabel('微信进程',{exact:true}).waitFor();
 await page.getByLabel('微信发送授权').fill('*');
 await page.getByLabel('微信发送黑名单').fill('wxid_blocked123');
 assert.deepEqual((await page.evaluate(()=>window.cshell.wechatStatus())).config.send,[]);
 await page.getByLabel('微信备注授权').fill('wxid_fixture123');
 await page.getByRole('button',{name:'保存',exact:true}).click();
 await page.getByRole('status').filter({hasText:'已保存'}).waitFor();
 const status=await page.evaluate(()=>window.cshell.wechatStatus());
 assert.equal(status.config.enabled,false);assert.deepEqual(status.config.sendBlocked,['wxid_blocked123']);assert.deepEqual(status.config.send,['*']);assert.deepEqual(status.config.remarks,['wxid_fixture123']);
 assert.equal(await page.getByText('先连接一台服务器，再选择安装或管理环境。',{exact:true}).count(),0);
 await page.screenshot({path:'test-results/wechat-extension.png'});
 await page.reload();
 const persisted=await page.evaluate(()=>window.cshell.wechatStatus());assert.deepEqual(persisted.config.sendBlocked,['wxid_blocked123']);assert.deepEqual(persisted.config.send,['*']);assert.deepEqual(persisted.config.remarks,['wxid_fixture123']);
 console.log('PASS: installed plugin; opened inline view; saved disabled draft; persistence; no remote target placeholder');
}finally{await app.close();await rm(data,{recursive:true,force:true});}
