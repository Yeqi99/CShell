import {build} from 'esbuild';
import {chromium} from 'playwright';
import {mkdtemp,readFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const dir=await mkdtemp(join(tmpdir(),'connection-view-ui-'));
await build({stdin:{contents:`
import './src/ui/styles.css';import React,{useState}from'react';import{createRoot}from'react-dom/client';
import{ServerSidebar}from'./src/ui/components/ServerSidebar';import{SavedConnection}from'./src/ui/components/SavedConnection';
import{VisualSshTerminal}from'./src/ui/components/VisualSshTerminal';import{ToolsPanel}from'./src/ui/components/ToolsPanel';
import{defaults}from'./src/shared/contracts';
window.calls=[];window.saved=[];window.visual=0;window.savedProfiles=[];
window.cshell={list:async(id,path)=>{window.calls.push(['list',id,path]);return{path:'/fixture',entries:[]}},monitor:async(id)=>{window.calls.push(['monitor',id]);throw Error('Isolated fixture: no live telemetry')},resourceHardware:async(id)=>{window.calls.push(['hardware',id]);return{gpus:[]}},events:()=>()=>{}};
const initial={id:'test',name:'测试服务器',host:'example.com',port:22,username:'root',protocol:'ssh',auth:'password',group:'开发环境',favorite:false};
function App(){const[p,setP]=useState(defaults),[profile,setProfile]=useState(initial),[mode,setMode]=useState('sidebar'),[closed,setClosed]=useState(false);window.setMode=setMode;window.setClosed=setClosed;
return <><div hidden={mode!=='sidebar'} style={{height:700}}><div style={{display:'flex',height:'100%'}}><div style={{width:280}}><ServerSidebar preferences={p} onPreferences={async v=>{setP(v);window.saved.push(v)}} profiles={[profile]} groups={['开发环境']} online={[]} onOpen={()=>{}} onConnect={()=>{}} onVisual={()=>window.visual++} onSave={async v=>{setProfile(v);window.savedProfiles.push(v)}} onDelete={()=>{}} onManageGroup={async()=>{}}/></div><SavedConnection visual={false} profile={profile} saved={false} onConnect={async()=>{}} onDone={()=>{}}/></div></div>
<div hidden={mode!=='terminal'}><main id="terminal-fixture" style={{width:900,height:650}}><VisualSshTerminal active={mode==='terminal'} closed={closed} tools={active=><ToolsPanel sessionId="fixture-session" sessionName="隔离测试" active={active} dockerEnabled={false} transfers={[]} onError={()=>{}}/>}><textarea aria-label="PTY 占位测试草稿" defaultValue="保持终端历史与输入" style={{width:'100%',height:'100%'}}/></VisualSshTerminal></main></div></>};
createRoot(document.getElementById('app')).render(<App/>);`,resolveDir:process.cwd(),loader:'tsx'},loader:{'.png':'dataurl','.svg':'dataurl','.woff2':'dataurl'},bundle:true,jsx:'automatic',outfile:join(dir,'fixture.js')});
const browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined});
try{
  const page=await browser.newPage({viewport:{width:1100,height:800}}),errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://fixture.invalid/',r=>r.fulfill({body:'<html data-theme="light"><div id="app"></div></html>',contentType:'text/html'}));
  await page.goto('https://fixture.invalid/');await page.addStyleTag({content:await readFile(join(dir,'fixture.css'),'utf8')});await page.addScriptTag({content:await readFile(join(dir,'fixture.js'),'utf8')});
  assert.equal(await page.locator('.linux-desktop-host').count(),0);await page.locator('.saved-connection input[type=password]').waitFor();
  await page.locator('aside.sidebar').dispatchEvent('contextmenu',{clientX:80,clientY:690});
  const appearance=page.getByRole('menu',{name:'侧边栏外观'});await appearance.waitFor();
  assert.equal(await page.getByLabel('服务器字号增大',{exact:true}).isVisible(),false);
  await page.getByRole('menuitem',{name:'外观设置',exact:true}).click();
  const bounds=await appearance.boundingBox();assert(bounds&&bounds.y>=0&&bounds.y+bounds.height<=800);
  await page.getByLabel('服务器字号增大',{exact:true}).click();await page.waitForFunction(()=>window.saved.length===1);
  assert.equal(await page.evaluate(()=>window.saved[0].sidebarFontSize),13);
  await page.getByRole('menuitem',{name:'恢复默认外观'}).click();await page.waitForFunction(()=>window.saved.length===2);
  assert.equal(await page.evaluate(()=>window.saved[1].sidebarFontSize),12);assert.equal(await page.evaluate(()=>window.saved[1].sidebarGroupSize),14);
  await mkdir('test-results/connection-view',{recursive:true});await page.screenshot({path:'test-results/connection-view/sidebar-appearance.png'});
  await page.keyboard.press('Escape');assert.equal(await page.getByRole('menu').count(),0);
  await page.getByText('测试服务器',{exact:true}).first().click({button:'right'});
  const defaultMode=page.getByRole('menuitemcheckbox',{name:'默认以可视化打开'});assert.equal(await defaultMode.getAttribute('aria-checked'),'false');await defaultMode.click();
  await page.waitForFunction(()=>window.savedProfiles.length===1);assert.equal(await page.evaluate(()=>window.savedProfiles[0].defaultConnectionView),'visual');
  await page.getByText('测试服务器',{exact:true}).first().click({button:'right'});assert.equal(await defaultMode.getAttribute('aria-checked'),'true');
  await page.getByRole('menuitem',{name:'打开可视化桌面',exact:true}).click();assert.equal(await page.evaluate(()=>window.visual),1);
  await page.evaluate(()=>window.setMode('terminal'));assert.equal(await page.locator('.tools-panel').count(),0);assert.equal(await page.evaluate(()=>window.calls.length),0);
  const pty=page.getByLabel('PTY 占位测试草稿');await pty.fill('保留这段输入与历史');await pty.evaluate(el=>el.dataset.identity='same-pty');
  const reveal=page.getByRole('button',{name:'文件与机器信息',exact:true});await reveal.click();await page.getByLabel('路径',{exact:true}).waitFor();
  await page.waitForFunction(()=>window.calls.some(c=>c[0]==='list')&&window.calls.some(c=>c[0]==='monitor'));
  assert((await page.evaluate(()=>window.calls)).every(c=>c[1]==='fixture-session'));
  await page.getByLabel('路径',{exact:true}).fill('/keep-path-draft');await reveal.click();assert.equal(await page.locator('.tools-panel').isVisible(),false);
  assert.equal(await pty.inputValue(),'保留这段输入与历史');assert.equal(await pty.getAttribute('data-identity'),'same-pty');
  await reveal.click();assert.equal(await page.getByLabel('路径',{exact:true}).inputValue(),'/keep-path-draft');
  for(const width of [400,900]){await page.locator('#terminal-fixture').evaluate((el,value)=>el.style.width=value+'px',width);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    const output=await page.locator('.visual-ssh-output').boundingBox(),tools=await page.locator('.visual-ssh-tools').boundingBox();assert(output&&tools);assert(width===400?tools.y>=output.y+output.height-1:tools.x>=output.x+output.width-1);await page.locator('.queue-toggle').scrollIntoViewIfNeeded();const queue=await page.locator('.queue-toggle').boundingBox();assert(queue&&queue.y>=tools.y&&queue.y+queue.height<=tools.y+tools.height+1);await page.locator('.visual-ssh-tools').evaluate(el=>el.scrollTop=0);await page.screenshot({path:'test-results/connection-view/visual-ssh-'+width+'.png'});}
  await page.evaluate(()=>window.setClosed(true));await page.getByRole('status').filter({hasText:'连接已断开'}).waitFor();assert.equal(await page.locator('.tools-panel').isVisible(),false);assert.equal(await pty.inputValue(),'保留这段输入与历史');
  assert.deepEqual(errors,[]);console.log('PASS collapsed appearance menu, smaller defaults, profile override, explicit visual entry, ToolsPanel lazy mount, target binding, responsive split, draft/PTY host retention and disconnected state');
}finally{await browser.close();await rm(dir,{recursive:true,force:true});}
