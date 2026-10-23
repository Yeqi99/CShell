import { _electron as electron } from 'playwright';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {fixture} from '../tests/fixture';
const directory=await mkdtemp(join(tmpdir(),'cshell-workspace-'));
const server=await fixture();const env={...process.env,CSHELL_TEST_DATA:directory};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({args:['.'],env});
try{
 const page=await app.firstWindow();page.setDefaultTimeout(15000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.getByTitle('偏好设置',{exact:true}).waitFor();
 await page.evaluate(async port=>window.cshell.saveProfile({id:crypto.randomUUID(),name:'Workspace fixture',host:'127.0.0.1',port,username:'tester',auth:'password',group:'',favorite:false}),server.port);
 await page.reload();await page.locator('.server-open').filter({hasText:'Workspace fixture'}).dblclick();
 await page.locator('.linux-desktop:visible').waitFor();
 await page.locator('.saved-connection:visible input[type=password]').fill(server.password);
 await app.evaluate(({dialog})=>{dialog.showMessageBox=(async()=>({response:1,checkboxChecked:false})) as typeof dialog.showMessageBox;});
 await page.locator('.saved-connection:visible').getByRole('button',{name:'连接',exact:true}).click();
 await page.locator('.linux-desktop:visible .terminal-pane').waitFor();
 assert.equal(await page.locator('.linux-mode-bar').count(),0);
 await page.locator('.linux-desktop:visible').getByRole('button',{name:'安装 CAgent',exact:true}).waitFor();
 await page.locator('.linux-desktop:visible .xterm-helper-textarea').focus();await page.keyboard.type('preserved-input');
 await page.waitForFunction(()=>document.querySelector('.terminal-pane')!==null);
 assert(server.shellInputs.join('').includes('preserved-input'));
 await page.locator('.linux-desktop:visible').getByTitle('收起窗口，保留会话',{exact:true}).click();
 assert.equal(server.shellRequests(),1);
 await server.disconnectAll();await page.getByRole('button',{name:'连接已断开，重试',exact:true}).waitFor();
 await page.locator('.linux-desktop:visible').waitFor();assert.equal(await page.locator('.desktop-disconnected').count(),0);
 await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/unified-workspace-offline.png'});assert.deepEqual(errors,[]);
 console.log('PASS SSH desktop before authentication, actual terminal, retained session and offline desktop');
}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});await server.close();await rm(directory,{recursive:true,force:true});}

