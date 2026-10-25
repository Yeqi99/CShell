import {_electron as electron,chromium,type Browser} from 'playwright';
import {mkdtemp,mkdir,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import assert from 'node:assert/strict';
import {fixture} from '../tests/fixture';

// Opt-in actual Electron + loopback SFTP regression. No user configuration or remote credentials.
const executable=process.env.APP_PATH??process.env.CSHELL_EXECUTABLE;
const args:unknown=process.env.APP_ARGS?JSON.parse(process.env.APP_ARGS):executable?undefined:['.'];
assert(args===undefined||Array.isArray(args)&&args.every(value=>typeof value==='string'),'APP_ARGS must be a JSON string array');
const atomic=process.env.SFTP_ATOMIC!=='false';
const data=await mkdtemp(join(tmpdir(),'cshell-file-package-')),server=await fixture({opensshRename:atomic});
const output=resolve('test-results/file-connection-package');await mkdir(output,{recursive:true});
const app=await electron.launch({...(executable?{executablePath:executable}:{}),args:args as string[]|undefined,env:{...process.env,CSHELL_TEST_DATA:data,CSHELL_TEST_START_GATE:'1'},timeout:60000});
let attached:Browser|undefined;
try{
 await app.evaluate(()=>{(globalThis as any).__cshellPackagedTestAttached=true;});
 let page=app.context().pages()[0];
 if(!page)try{page=await app.context().waitForEvent('page',{timeout:5000});}catch{
   // In development Electron can create the window before Playwright's discovery
   // subscription attaches. Reattach only to this isolated instance's local CDP.
   const port=Number((await readFile(join(data,'DevToolsActivePort'),'utf8')).split('\n')[0]);assert(Number.isInteger(port)&&port>0&&port<=65535);
   attached=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);page=attached.contexts()[0]?.pages().find(candidate=>candidate.url().startsWith('file:'))!;assert(page,'isolated application page was not discovered');
 }
 page.setDefaultTimeout(25000);
 const pageErrors:string[]=[];page.on('pageerror',error=>pageErrors.push(error.message));
 await page.waitForFunction(()=>!!window.cshell);await page.getByRole('tab',{name:'概览',exact:true}).waitFor();
 await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});});
 await page.getByRole('button',{name:'新建连接',exact:true}).first().click();await page.getByRole('button',{name:'SFTP',exact:true}).click();
 const form=page.locator('.connection-editor:visible');await form.getByLabel('保存到服务器列表').check();await form.getByLabel('名称',{exact:true}).fill('SFTP isolated fixture');await form.getByLabel('主机地址').fill('127.0.0.1');await form.getByLabel('端口',{exact:true}).fill(String(server.port));await form.getByLabel('用户名',{exact:true}).fill('tester');await form.locator('.connection-secret input').fill(server.password);await form.getByLabel('使用系统加密保存凭据').check();await form.getByRole('button',{name:'保存并连接',exact:true}).click();
 const workspace=page.locator('.file-workspace-host:visible');await workspace.getByText('hello.txt',{exact:true}).waitFor();
 const firstId=await page.locator('.session-tab.active').getAttribute('data-session');assert(firstId);assert.equal(server.shellRequests(),0);
 assert.equal(await workspace.locator('.xterm,.monitor-panel').count(),0);assert.equal(await page.locator('.session-tab.active .tab-float').count(),0);
 assert.equal(await page.locator('.ssh-files-toggle:visible').count(),0);
 const config=await page.evaluate(()=>window.cshell.config()),saved=config.profiles.find(profile=>profile.name==='SFTP isolated fixture');assert(saved);assert.equal(saved.protocol,'sftp');
 await workspace.getByText('hello.txt',{exact:true}).dblclick();await workspace.locator('.cm-content').waitFor();await workspace.locator('.cm-content').fill('SFTP retained draft');
 await page.locator('.welcome-tab').getByRole('button').click();assert.equal(await workspace.count(),0);
 for(const name of ['命令行','可视化','概览']){await page.getByRole('tab',{name,exact:true}).click();assert.equal(await page.getByRole('tab',{name,exact:true}).getAttribute('aria-selected'),'true');}
 assert.equal((await page.evaluate(()=>window.cshell.config())).preferences.defaultConnectionView,'original');
 await page.locator(`[data-session="${firstId}"]`).getByRole('button',{name:'SFTP isolated fixture',exact:true}).click();assert.equal(await workspace.locator('.cm-content').innerText(),'SFTP retained draft');
 await workspace.getByRole('button',{name:'保存文件',exact:true}).click();
 if(atomic){await page.waitForFunction(()=>document.querySelector('.file-workspace-host:not([hidden]) .python-editor footer')?.textContent?.includes('已同步'));assert.equal(await readFile(join(server.root,'hello.txt'),'utf8'),'SFTP retained draft');}
 else{await workspace.getByText(/服务器不支持安全的原子替换/).waitFor();assert.equal(await readFile(join(server.root,'hello.txt'),'utf8'),'你好，CShell 🌏\n');assert.equal(await workspace.locator('.cm-content').innerText(),'SFTP retained draft');}
 await workspace.getByRole('button',{name:'文件',exact:true}).click();await workspace.locator('.file-row').filter({hasText:'hello.txt'}).click({modifiers:['Control']});await workspace.getByRole('button',{name:'新建目录',exact:true}).click();await workspace.locator('.inline-file-editor input').fill('fixture-folder');await workspace.getByRole('button',{name:'确认',exact:true}).click();await workspace.getByText('fixture-folder',{exact:true}).waitFor();
 await workspace.getByRole('button',{name:'hello.txt',exact:true}).click();await workspace.locator('.cm-content').fill('unsaved before disconnect');
 server.disconnectAll();await workspace.getByText('连接已断开',{exact:true}).waitFor();assert.equal(await page.locator('.disconnected-session-bar:visible').count(),0);assert.equal(await workspace.locator('.cm-content').innerText(),'unsaved before disconnect');assert(await workspace.getByRole('button',{name:'保存文件',exact:true}).isDisabled());
 await workspace.getByRole('button',{name:'重新连接',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.file-workspace-host').length===2);await page.locator('.file-workspace-host:visible').getByText('hello.txt',{exact:true}).waitFor();const secondId=await page.locator('.session-tab.active').getAttribute('data-session');assert(secondId&&secondId!==firstId);assert.equal(server.shellRequests(),0);
 await page.locator(`[data-session="${firstId}"]`).getByRole('button',{name:'SFTP isolated fixture',exact:true}).click();assert.equal(await page.locator('.file-workspace-host:visible .cm-content').innerText(),'unsaved before disconnect');
 await page.screenshot({path:join(output,'sftp-old-draft-after-reconnect.png')});
 assert.deepEqual(pageErrors,[]);console.log('PASS real Electron SFTP entry/connect/read/'+(atomic?'atomic-save':'unsupported-save-safe-rejection')+'/mkdir, 0 shell requests, no floating terminal, three home modes, offline draft retained and reconnect gets a distinct session');
}catch(error){const page=app.context().pages()[0]??attached?.contexts()[0]?.pages()[0];if(page&&!page.isClosed()){await page.screenshot({path:join(output,'failure.png')});console.error((await page.locator('body').innerText()).slice(-5000));}throw error;}
finally{await app.close();await attached?.close();server.disconnectAll();await server.close();assert(data.startsWith(resolve(tmpdir())+sep));await rm(data,{recursive:true,force:true,maxRetries:20,retryDelay:200});}
