const {_electron}=require('playwright');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
(async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cshell-profile-smoke-'));
 const data=path.join(root,'data'),server=path.join(root,'server.json'),wrapper=path.join(root,'launch.cjs');
 await fs.writeFile(wrapper,`
 const e=require('electron'),fs=require('node:fs');
 e.app.setPath('appData',${JSON.stringify(root)});
 const file=${JSON.stringify(server)};
 e.dialog.showErrorBox=(_title,message)=>console.error('STARTUP: '+message);
 global.__realQuit=e.app.quit.bind(e.app);
 e.app.relaunch=()=>{global.__relaunched=true;};
 e.app.quit=()=>{if(!global.__relaunched)global.__realQuit();};
 e.net.fetch=async(url,options)=>{
  const p=new URL(url).pathname,b=options?.body?JSON.parse(options.body):undefined;
  let v;try{v=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}
  if(p.endsWith('/auth/register')){v={...b,revision:1};fs.writeFileSync(file,JSON.stringify(v));return Response.json({accountId:b.accountId,email:b.email,token:'x'.repeat(43)});}
  if(p.endsWith('/vault')){if(b){v.envelope=b.envelope;v.revision++;fs.writeFileSync(file,JSON.stringify(v));}return Response.json({revision:v.revision,envelope:v.envelope});}
  if(p.endsWith('/account'))return Response.json({membership:{active:false,expiresAt:null},storage:{usedBytes:0,limitBytes:2097152}});
  if(p.endsWith('/models'))return Response.json({models:[]});
  if(p.endsWith('/auth/logout'))return Response.json({ok:true});
  throw Error('Unexpected test request '+p);
 };
 require(${JSON.stringify(path.resolve('dist/main/main.cjs'))});
 `);
 const env={...process.env,CSHELL_TEST_DATA:data};delete env.ELECTRON_RUN_AS_NODE;
 let app;
 const launch=async()=>{app=await _electron.launch({args:[wrapper],env});app.process().stderr.on('data',data=>{const text=data.toString();if(text.includes('STARTUP:'))console.error(text.trim());});const p=await app.firstWindow();await p.waitForFunction(()=>!!window.cshell);await p.evaluate(()=>window.cshell.cloudStatus());return p;};
 const close=async()=>{if(!app)return;await app.evaluate(({app})=>{app.quit=global.__realQuit;});await app.close();app=undefined;};
 try{
  console.log("guest launch");let page=await launch();
  await page.evaluate(async()=>{
   await window.cshell.saveProfile({id:'10000000-0000-4000-8000-000000000001',name:'Guest only',protocol:'ssh',host:'guest.invalid',port:22,username:'guest',auth:'password',group:'',favorite:false});
   await window.cshell.cloudRemember({text:'Guest-only habit'});localStorage.setItem('account-fixture','guest-only');
  });
  await app.evaluate(async({session})=>{await session.defaultSession.cookies.set({url:'https://fixture.invalid',name:'guest',value:'only',expirationDate:Math.floor(Date.now()/1000)+3600});});
  await page.evaluate(()=>window.cshell.cloudRegister('fixture@example.com','123456','fixture-password'));
  await page.waitForTimeout(150);
  assert(await app.evaluate(()=>global.__relaunched));await close();
  console.log("profile relaunch");page=await launch();
  assert.equal((await page.evaluate(()=>window.cshell.config())).profiles.length,0);
  assert.deepEqual(await page.evaluate(()=>window.cshell.cloudMemory()),[]);
  assert.equal(await page.evaluate(()=>localStorage.getItem('account-fixture')),null);
  assert.deepEqual(await app.evaluate(({session})=>session.defaultSession.cookies.get({url:'https://fixture.invalid'})),[]);
  await page.getByRole('button',{name:'账号与会员',exact:true}).click();
  await page.getByRole('button',{name:/Pro 未登录工作区/}).click();
  await page.getByRole('button',{name:'载入当前账号',exact:true}).waitFor();
  await fs.mkdir('test-results',{recursive:true});
  await page.screenshot({path:'test-results/account-import-preview.png'});
  assert.equal((await page.evaluate(()=>window.cshell.config())).profiles.length,0,'preview must not import');
  await page.getByRole('button',{name:'载入当前账号',exact:true}).click();
  await page.getByText('已载入当前账号，云同步会自动继续。',{exact:true}).waitFor();
  assert.equal((await page.evaluate(()=>window.cshell.config())).profiles[0].name,'Guest only');
  assert.equal((await page.evaluate(()=>window.cshell.cloudMemory()))[0].text,'Guest-only habit');
  if(process.argv.includes('--clear')){
   await page.getByRole('button',{name:'清除未登录数据…',exact:true}).click();
   await page.getByRole('button',{name:'取消',exact:true}).click();
   assert.equal(JSON.parse(await fs.readFile(path.join(data,'config.json'),'utf8')).profiles.length,1);
   await page.getByRole('button',{name:'清除未登录数据…',exact:true}).click();
   await page.getByRole('button',{name:'确认清除未登录数据',exact:true}).click();
   await page.getByText('未登录工作区的数据已清除。',{exact:true}).waitFor();
   assert.equal((await page.evaluate(()=>window.cshell.config())).profiles[0].name,'Guest only','account preserved');
  }
  await page.evaluate(()=>window.cshell.cloudLogout());await page.waitForTimeout(150);await close();
  page=await launch();
  if(process.argv.includes('--clear')){
   assert.equal((await page.evaluate(()=>window.cshell.config())).profiles.length,0);
   assert.deepEqual(await page.evaluate(()=>window.cshell.cloudMemory()),[]);
   assert.equal(await page.evaluate(()=>localStorage.getItem('account-fixture')),null);
   assert.deepEqual(await app.evaluate(({session})=>session.defaultSession.cookies.get({url:'https://fixture.invalid'})),[]);
   console.log('PASS guest clear confirmation: cancel preserves data, clear preserves account, logout opens empty guest');return;
  }
  assert.equal((await page.evaluate(()=>window.cshell.config())).profiles[0].name,'Guest only');
  assert.equal((await page.evaluate(()=>window.cshell.cloudMemory()))[0].text,'Guest-only habit');
  assert.equal(await page.evaluate(()=>localStorage.getItem('account-fixture')),'guest-only');
  assert.equal((await app.evaluate(({session})=>session.defaultSession.cookies.get({url:'https://fixture.invalid'})))[0].value,'only');
  console.log('PASS real Electron explicit import: preview does not import; confirmation loads configuration and encrypted habits; original guest remains');
 }finally{await close();await fs.rm(root,{recursive:true,force:true,maxRetries:5});}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
