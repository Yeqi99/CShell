const {_electron}=require('playwright');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
(async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cshell-recovery-smoke-')),data=path.join(root,'data'),fixture=path.join(root,'fixture.cjs'),wrapper=path.join(root,'launch.cjs');
 const env={...process.env,CSHELL_TEST_DATA:data};delete env.ELECTRON_RUN_AS_NODE;let app;
 const close=async()=>{if(!app)return;await app.evaluate(({app})=>{if(global.__realQuit)app.quit=global.__realQuit;});await app.close();app=undefined;};
 try{
  await fs.mkdir(data);
  await fs.writeFile(fixture,`const {app,safeStorage}=require('electron'),fs=require('node:fs');app.setPath('userData',${JSON.stringify(data)});app.whenReady().then(async()=>{const bytes=await safeStorage.encryptStringAsync(JSON.stringify({session:{accountId:'b'.repeat(32),email:'fixture@example.com',token:'x'.repeat(43)},key:'x'.repeat(43),revision:7}));fs.writeFileSync(${JSON.stringify(path.join(data,'cloud-sync.enc'))},bytes.toString('base64'));global.__ready=true;});`);
  app=await _electron.launch({args:[fixture],env});for(let i=0;i<100&&!await app.evaluate(()=>global.__ready===true);i++)await new Promise(r=>setTimeout(r,50));await close();
  const original=await fs.readFile(path.join(data,'cloud-sync.enc'),'utf8');
  await fs.writeFile(path.join(data,'account-profile.json'),JSON.stringify({version:1,legacy:'a'.repeat(32),active:'a'.repeat(32)}));
  await fs.writeFile(path.join(data,'retained-fixture.txt'),'original account files');
  await fs.writeFile(wrapper,`const e=require('electron');e.app.setPath('appData',${JSON.stringify(root)});global.__requests=0;global.__dialogs=0;global.__realQuit=e.app.quit.bind(e.app);e.app.relaunch=()=>{global.__relaunched=true;};e.app.quit=()=>{if(!global.__relaunched)global.__realQuit();};e.dialog.showErrorBox=()=>{global.__dialogs++;};e.net.fetch=async()=>{global.__requests++;throw Error('No cloud requests allowed');};require(${JSON.stringify(path.resolve('dist/main/main.cjs'))});`);
  app=await _electron.launch({args:[wrapper],env});
  let restarted=false;for(let i=0;i<200;i++){restarted=await app.evaluate(()=>global.__relaunched===true);if(restarted)break;await new Promise(r=>setTimeout(r,50));}
  assert(restarted,'recovery must restart into guest');assert.equal(await app.evaluate(()=>global.__dialogs),0);assert.equal(await app.evaluate(()=>global.__requests),0);await close();
  const backup=(await fs.readdir(data)).find(n=>n.startsWith('cloud-sync-recovery-'));assert(backup);assert.equal(await fs.readFile(path.join(data,backup),'utf8'),original);assert.equal(await fs.readFile(path.join(data,'retained-fixture.txt'),'utf8'),'original account files');
  app=await _electron.launch({args:[wrapper],env});const page=await app.firstWindow();await page.waitForFunction(()=>!!window.cshell);const status=await page.evaluate(()=>window.cshell.cloudStatus());assert.equal(status.email,undefined);assert.equal(status.workspaceRecovered,true);assert.equal((await page.evaluate(()=>window.cshell.config())).profiles.length,0);assert.equal(await app.evaluate(()=>global.__requests),0);
  await page.getByRole('button',{name:'账号与会员',exact:true}).click();await page.getByText('已恢复到未登录工作区。原账号配置保留，重新登录即可继续。',{exact:true}).waitFor();
  await fs.mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/account-recovery.png'});
  console.log('PASS mismatch recovery: authentication backup retained, account files unchanged, clean guest reopened, no cloud calls or native dialogs');
 }finally{await close();await fs.rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
