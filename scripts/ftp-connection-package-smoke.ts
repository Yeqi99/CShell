import {_electron as electron,chromium,type Browser} from 'playwright';
import {mkdtemp,mkdir,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import assert from 'node:assert/strict';
import {ftpFixture} from '../tests/helpers/ftp-server';

// Opt-in actual Electron + local FTP sockets. No user accounts, files or targets.
const executable=process.env.APP_PATH??process.env.CSHELL_EXECUTABLE;
const args:unknown=process.env.APP_ARGS?JSON.parse(process.env.APP_ARGS):executable?undefined:['.'];
assert(args===undefined||Array.isArray(args)&&args.every(value=>typeof value==='string'),'APP_ARGS must be a JSON string array');
const data=await mkdtemp(join(tmpdir(),'cshell-ftp-package-')),server=await ftpFixture();
const upload=join(data,'uploaded.txt'),downloads=join(data,'downloads'),payload='Actual Electron FTP upload 中文\n';
await mkdir(downloads);await writeFile(upload,payload);
const output=resolve('test-results/ftp-connection-package');await mkdir(output,{recursive:true});
const app=await electron.launch({...(executable?{executablePath:executable}:{}),args:args as string[]|undefined,env:{...process.env,CSHELL_TEST_DATA:data,CSHELL_TEST_START_GATE:'1'},timeout:60000});
let attached:Browser|undefined;
try{
 await app.evaluate(()=>{(globalThis as any).__cshellPackagedTestAttached=true;});
 let page=app.context().pages()[0];
 if(!page)try{page=await app.context().waitForEvent('page',{timeout:5000});}catch{
   const port=Number((await readFile(join(data,'DevToolsActivePort'),'utf8')).split('\n')[0]);assert(Number.isInteger(port)&&port>0&&port<=65535);
   attached=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);page=attached.contexts()[0]?.pages().find(candidate=>candidate.url().startsWith('file:'))!;assert(page,'isolated application page was not discovered');
 }
 page.setDefaultTimeout(25000);const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.waitForFunction(()=>!!window.cshell);await page.getByRole('tab',{name:'概览',exact:true}).waitFor();
 await app.evaluate(({dialog},{upload,downloads})=>{
   dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});
   dialog.showOpenDialog=(async(...parameters:any[])=>{const options=parameters.at(-1);return{canceled:false,filePaths:options.properties.includes('openDirectory')?[downloads]:[upload]};}) as any;
 },{upload,downloads});
 await page.getByRole('button',{name:'新建连接',exact:true}).first().click();await page.getByRole('button',{name:'FTP',exact:true}).click();
 const form=page.locator('.connection-editor:visible');await form.getByLabel('保存到服务器列表').check();await form.getByLabel('名称',{exact:true}).fill('FTP isolated fixture');await form.getByLabel('主机地址').fill('127.0.0.1');await form.getByLabel('端口',{exact:true}).fill(String(server.port));await form.getByLabel('用户名',{exact:true}).fill('fixture');await form.locator('.connection-secret input').fill('fixture-password');await form.getByLabel('使用系统加密保存凭据').check();await form.getByRole('button',{name:'保存并连接',exact:true}).click();
 const workspace=page.locator('.file-workspace-host:visible'),row=(name:string)=>workspace.getByRole('option').filter({has:page.getByText(name,{exact:true})});await row('hello.txt').waitFor();
 const firstId=await page.locator('.session-tab.active').getAttribute('data-session');assert(firstId);assert.equal(await workspace.locator('.xterm,.monitor-panel').count(),0);assert.equal(await page.locator('.session-tab.active .tab-float,.ssh-files-toggle:visible').count(),0);
 assert.equal((await page.evaluate(()=>window.cshell.config())).profiles.find(profile=>profile.name==='FTP isolated fixture')?.protocol,'ftp');
 await row('docs').dblclick();await row('note.txt').waitFor();assert.equal(await workspace.getByRole('textbox',{name:'路径',exact:true}).inputValue(),'/docs');await workspace.getByRole('button',{name:'上级目录',exact:true}).click();await row('hello.txt').waitFor();
 await workspace.getByRole('button',{name:'上传文件',exact:true}).click();await row('uploaded.txt').waitFor();assert.equal(server.files.get('/uploaded.txt')?.toString(),payload);
 await row('uploaded.txt').click();await workspace.getByRole('button',{name:'重命名',exact:true}).click();await workspace.getByRole('textbox',{name:'新名称',exact:true}).fill('renamed.txt');await workspace.getByRole('button',{name:'保存',exact:true}).click();await row('renamed.txt').waitFor();assert.equal(server.files.get('/renamed.txt')?.toString(),payload);assert(!server.files.has('/uploaded.txt'));
 await row('renamed.txt').click();await workspace.getByRole('button',{name:'下载',exact:true}).click();await workspace.locator('.file-transfer-item').filter({hasText:'↓ renamed.txt'}).getByText('已完成',{exact:true}).waitFor();assert.equal(await readFile(join(downloads,'renamed.txt'),'utf8'),payload);
 await workspace.getByRole('button',{name:'新建目录',exact:true}).click();await workspace.getByRole('textbox',{name:'目录名称',exact:true}).fill('created-empty');await workspace.getByRole('button',{name:'保存',exact:true}).click();await row('created-empty').waitFor();assert(server.dirs.has('/created-empty'));
 await row('created-empty').click();assert(await workspace.getByRole('button',{name:'下载',exact:true}).isDisabled());await workspace.getByRole('button',{name:'删除',exact:true}).click();assert(server.dirs.has('/created-empty'));await workspace.getByRole('button',{name:'确认删除',exact:true}).click();await row('created-empty').waitFor({state:'hidden'});assert(!server.dirs.has('/created-empty'));
 await workspace.getByRole('textbox',{name:'路径',exact:true}).fill('/unsubmitted-path-draft');server.disconnectAll();await workspace.getByText('连接已断开',{exact:true}).waitFor();assert(await workspace.getByRole('button',{name:'上传文件',exact:true}).isDisabled());assert.equal(await workspace.locator('.file-connection-content').getAttribute('inert'),'');assert.equal(await page.locator('.disconnected-session-bar:visible').count(),0);
 await workspace.getByRole('button',{name:'重新连接',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.file-workspace-host').length===2);await row('renamed.txt').waitFor();const secondId=await page.locator('.session-tab.active').getAttribute('data-session');assert(secondId&&secondId!==firstId);
 await page.locator(`[data-session="${firstId}"]`).getByRole('button',{name:'FTP isolated fixture',exact:true}).click();assert.equal(await workspace.getByRole('textbox',{name:'路径',exact:true}).inputValue(),'/unsubmitted-path-draft');await workspace.getByText('连接已断开',{exact:true}).waitFor();await page.screenshot({path:join(output,'ftp-reconnect-old-context.png')});
 await page.getByRole('button',{name:'新建连接',exact:true}).first().click();await page.getByRole('button',{name:'FTPS',exact:true}).click();await page.getByRole('heading',{name:'FTPS · 文件连接',exact:true}).waitFor();await page.getByText('显式 TLS 加密连接，校验证书与服务器名称。',{exact:true}).waitFor();assert.equal(await page.locator('.connection-editor:visible input[type="radio"]').count(),0);await page.screenshot({path:join(output,'ftps-connection-entry.png')});
 assert(!server.commands.some(command=>/^(EXEC|SHELL)/.test(command)));assert.deepEqual(errors,[]);
 console.log('PASS real Electron FTP entry/list/subdirectory/upload/rename/download byte equality/mkdir/confirmed empty-directory delete/offline disable/reconnect distinct session/retained old path draft; FTPS entry and certificate policy; no terminal or machine monitor');
}catch(error){const page=app.context().pages()[0]??attached?.contexts()[0]?.pages()[0];if(page&&!page.isClosed()){await page.screenshot({path:join(output,'failure.png')});console.error((await page.locator('body').innerText()).slice(-6000));}throw error;}
finally{await app.close();await attached?.close();await server.close();assert(data.startsWith(resolve(tmpdir())+sep));await rm(data,{recursive:true,force:true,maxRetries:20,retryDelay:200});}
