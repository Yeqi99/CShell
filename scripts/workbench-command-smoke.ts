import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = await mkdtemp(join(tmpdir(), 'cshell-workbench-command-'));
await build({stdin:{contents:`
  import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
  import './src/ui/styles.css'; import {WorkbenchHome} from './src/ui/components/WorkbenchHome';
  import {defaults} from './src/shared/contracts'; import {commandHelp,parseConsoleCommand} from './src/shared/command-console';
  window.calls=[]; window.actions=[]; const tool={id:'app.echo',name:'echo',description:'返回当前输入，验证表单',permission:'test.read',effects:'read',inputSchema:{type:'object',properties:{message:{type:'string',description:'待返回的文字'}},required:['message']},examples:[{input:{message:'示例'},explanation:'回显'}]};
  window.cshell={monitorViews:async()=>[],commandStatus:async()=>({enabled:true,running:true}),commandCancel:async id=>window.actions.push(['cancel',id]),commandRun:async input=>{
    window.calls.push(input); const p=parseConsoleCommand(input.text);
    if(p.type==='help')return {kind:'help',title:'help',value:commandHelp};
    if(p.type==='catalog')return {kind:'catalog',title:'能力',value:[tool]};
    if(p.type==='context')return {kind:'context',title:'已切换',value:{},sessionId:p.sessionId};
    return {kind:'result',title:p.name,value:p.arguments};
  }};
  function Fixture(){const [config,setConfig]=useState({version:1,profiles:[],groups:[],savedCredentials:[],preferences:defaults});const [active,setActive]=useState(true);window.setActive=setActive;
    return <main id="workspace" style={{height:'100vh',width:900,minWidth:0}}><WorkbenchHome config={config} active={active} currentCount={0} onNew={()=>window.actions.push('new')} onViews={()=>{}} onConnect={()=>{}} onCurrent={async()=>{}} onView={async view=>{window.actions.push(['view',view]);setConfig(v=>({...v,preferences:{...v.preferences,workbenchView:view}}));}} onSettings={()=>window.actions.push('settings')} onExtensions={()=>window.actions.push('extensions')} onAgent={()=>window.actions.push('agent')} onCommandTab={()=>window.actions.push('command-tab')}/></main>;
  } createRoot(document.getElementById('root')).render(<Fixture/>);
`,loader:'tsx',resolveDir:process.cwd()},outfile:join(directory,'app.js'),bundle:true,jsx:'automatic',loader:{'.woff2':'dataurl','.svg':'dataurl'}});
const server = createServer(async (req,res)=>{const name=req.url==='/app.js'?'app.js':req.url==='/app.css'?'app.css':undefined;res.setHeader('Content-Type',name?name.endsWith('.js')?'text/javascript':'text/css':'text/html; charset=utf-8');res.end(name?await readFile(join(directory,name)):'<html data-theme="light"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script></html>');});
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined});
try {
  await mkdir('test-results/workbench-command',{recursive:true});
  const page=await browser.newPage({viewport:{width:1200,height:850}});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${(server.address() as {port:number}).port}`);
  await page.getByRole('tab',{name:'命令行',exact:true}).click();
  const input=page.getByRole('tabpanel',{name:'命令行',exact:true}).getByRole('textbox',{name:'输入 CShell 命令',exact:true});
  await input.fill('call echo {"message":"尚未发送的草稿"}');
  await page.getByRole('tab',{name:'概览',exact:true}).click();await page.getByRole('tab',{name:'命令行',exact:true}).click();
  assert.match(await input.inputValue(),/尚未发送/);assert.equal(await page.evaluate(()=>(window as any).calls.length),0);
  await input.press('Shift+Enter');assert.match(await input.inputValue(),/\n/);assert.equal(await page.evaluate(()=>(window as any).calls.length),0);
  await input.dispatchEvent('keydown',{key:'Enter',code:'Enter',isComposing:true});assert.equal(await page.evaluate(()=>(window as any).calls.length),0);
  await input.press('Enter');await page.getByRole('log').getByText('完成',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>(window as any).calls.length),1);
  assert.match(await page.getByRole('log').innerText(),/尚未发送的草稿/);
  await input.fill('call echo {"message":"独立草稿"}');
  await page.getByRole('button',{name:'新建命令台标签',exact:true}).click();assert((await page.evaluate(()=>(window as any).actions)).includes('command-tab'));
  await page.getByRole('tab',{name:'可视化',exact:true}).click();await page.locator('[data-desktop-icon="command"]').dblclick();
  const studio=page.locator('.desktop-window:visible');await studio.getByRole('textbox',{name:'输入 CShell 命令'}).fill('help');
  await page.getByRole('button',{name:'最小化命令台',exact:true}).click();await page.locator('.desktop-taskbar').getByRole('button',{name:'切换到命令台',exact:true}).click();assert.equal(await studio.getByRole('textbox').inputValue(),'help');
  await page.getByRole('tab',{name:'命令行',exact:true}).click();assert.match(await input.inputValue(),/独立草稿/);
  await page.getByRole('tab',{name:'可视化',exact:true}).click();await page.getByRole('button',{name:'最小化命令台',exact:true}).click();await page.locator('[data-desktop-icon="capabilities"]').dblclick();
  await page.getByRole('button',{name:/echo 返回当前输入/}).click();await page.getByLabel('message *').fill('从可视化表单执行');await page.getByRole('button',{name:'读取',exact:true}).click();await page.locator('.capability-result').getByText(/从可视化表单执行/).waitFor();
  for(const width of [340,600,900]){await page.locator('#workspace').evaluate((el,w)=>{(el as HTMLElement).style.width=w+'px';},width);assert(await page.locator('.workbench-shell').evaluate(el=>el.scrollWidth<=el.clientWidth+1),`No horizontal overflow ${width}`);await page.locator('#workspace').screenshot({path:`test-results/workbench-command/visual-${width}.png`});}
  await page.getByRole('button',{name:'最小化能力浏览器',exact:true}).click();await page.locator('#workspace').screenshot({path:'test-results/workbench-command/desktop.png'});
  await page.getByRole('tab',{name:'命令行',exact:true}).click();await page.locator('#workspace').screenshot({path:'test-results/workbench-command/command.png'});
  assert.deepEqual(errors,[]);console.log('Workbench modes: draft/result isolation, no replay, Enter/IME, minimize, visual schema call, responsive widths passed');
}finally{await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(directory,{recursive:true,force:true});}
