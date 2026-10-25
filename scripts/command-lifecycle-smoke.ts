import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const directory=await mkdtemp(join(tmpdir(),'cshell-command-lifecycle-'));
await build({stdin:{contents:`
 import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
 import {CommandConsole} from './src/ui/components/CommandConsole';import {CapabilityExplorer} from './src/ui/components/CapabilityExplorer';import {parseConsoleCommand} from './src/shared/command-console';
 window.calls=[];window.disconnectedIds=[];window.cancelled=[];window.hold=false;window.held=[];
 const tool={id:'write_text',name:'write_text',description:'写入所选机器',permission:'files.create',effects:'write',inputSchema:{type:'object',properties:{path:{type:'string'}},required:['path']},examples:[{input:{path:'/default'},explanation:'example'}]};
 window.cshell={commandStatus:async()=>({enabled:true,running:true}),commandCancel:async id=>{window.cancelled.push(id);},commandRun:async input=>{
  const p=parseConsoleCommand(input.text);window.calls.push(input);
  if(p.type==='invoke'&&p.name==='connect'){const sessionId=crypto.randomUUID();const result={kind:'result',title:'connect',value:{sessionId}};if(window.hold)return new Promise(resolve=>window.held.push(()=>resolve(result)));return result;}
  if(p.type==='invoke'&&p.name==='disconnect'){window.disconnectedIds.push(p.arguments.sessionId);return {kind:'result',title:'disconnect',value:{disconnected:true}};}
  if(p.type==='catalog')return {kind:'catalog',title:'tools',value:[tool]};
  if(p.type==='context')return {kind:'context',title:'context',value:{},sessionId:p.sessionId};
  if(p.type==='invoke'&&p.name==='slow')return new Promise(resolve=>window.held.push(()=>resolve({kind:'result',title:'slow',value:{}})));
  return{kind:'result',title:'call',value:p.arguments||{}};
 }};
 const base={protocol:'ssh',port:22,username:'test',auth:'password',favorite:false,group:''};
 function Fixture(){const [mode,setMode]=useState('explorer'),[generation,setGeneration]=useState(0),[active,setActive]=useState(true),[profiles,setProfiles]=useState([{...base,id:'11111111-1111-4111-8111-111111111111',name:'A',host:'a.test'},{...base,id:'22222222-2222-4222-8222-222222222222',name:'B',host:'b.test'}]);
 window.mount=value=>{setMode(value);setGeneration(x=>x+1)};window.modifyA=()=>setProfiles(v=>v.map(p=>p.name==='A'?{...p,host:'a-new.test'}:p));window.setActive=setActive;
 return mode==='none'?null:mode==='console'?<CommandConsole key={generation} active={active} onSettings={()=>{}}/>:<CapabilityExplorer key={generation} active={active} profiles={profiles} onSettings={()=>{}}/>;
 }createRoot(document.getElementById('root')).render(<Fixture/>);
`,loader:'tsx',resolveDir:process.cwd()},outfile:join(directory,'app.js'),bundle:true,jsx:'automatic'});
const server=createServer(async(req,res)=>{const file=req.url==='/app.js'?'app.js':req.url==='/app.css'?'app.css':undefined;res.setHeader('Content-Type',file?file.endsWith('.js')?'text/javascript':'text/css':'text/html; charset=utf-8');res.end(file?await readFile(join(directory,file)):'<meta charset="utf-8"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>');});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined});
try{
 const page=await browser.newPage(),errors:string[]=[];page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+(server.address() as any).port);
 console.log('Checking target and identity draft isolation');
 const range=page.getByRole('combobox',{name:'能力浏览器操作范围'}),load=page.getByRole('button',{name:'载入',exact:true}),choose=()=>page.getByRole('button',{name:/write_text 写入所选机器/}).click(),path=()=>page.getByLabel('path *');
 const target=async(id:string)=>{await range.selectOption(id);await load.click();await choose();};
 await target('11111111-1111-4111-8111-111111111111');await path().fill('/A/private');await range.selectOption('22222222-2222-4222-8222-222222222222');assert.equal(await page.getByRole('button',{name:'执行操作',exact:true}).isDisabled(),true);
 await load.click();await choose();assert.equal(await path().inputValue(),'/default');await path().fill('/B/private');
 await target('11111111-1111-4111-8111-111111111111');assert.equal(await path().inputValue(),'/A/private');
 await page.evaluate(()=>{(window as any).modifyA();});await page.waitForFunction(()=>document.querySelector<HTMLButtonElement>('.capability-actions button')?.disabled===true);await load.click();await choose();assert.equal(await path().inputValue(),'/default','changed identity receives a new draft namespace');
 await page.evaluate(()=>{(window as any).mount('none');});await page.waitForFunction(()=>!document.querySelector('.capability-explorer'));await page.waitForFunction(()=>(window as any).disconnectedIds.length===3);
 console.log('Checking pending explorer connect and close');
 await page.evaluate(()=>{(window as any).hold=true;(window as any).mount('explorer');});await range.selectOption('11111111-1111-4111-8111-111111111111');await load.evaluate((el:HTMLButtonElement)=>{el.click();el.click();});await page.waitForFunction(()=>(window as any).held.length===1);
 await page.evaluate(()=>{(window as any).mount('none');});await page.waitForFunction(()=>!document.querySelector('.capability-explorer'));assert.equal(await page.evaluate(()=>(window as any).cancelled.length),0);await page.evaluate(()=>{(window as any).held.shift()();});await page.waitForFunction(()=>(window as any).disconnectedIds.length===4);
 console.log('Checking command session ownership');
 await page.evaluate(()=>{(window as any).hold=false;(window as any).mount('console');});const input=page.getByRole('textbox',{name:'输入 CShell 命令'});await input.fill('connect 11111111-1111-4111-8111-111111111111');await input.press('Enter');await page.getByRole('log').getByText('完成',{exact:true}).waitFor();
 await input.fill('use 99999999-9999-4999-8999-999999999999');await input.press('Enter');await page.waitForFunction(()=>document.querySelector('.command-toolbar')?.textContent?.includes('99999999'));
 await page.evaluate(()=>{(window as any).setActive(false);});await page.evaluate(()=>{(window as any).setActive(true);});assert.equal(await page.evaluate(()=>(window as any).disconnectedIds.length),4,'hiding keeps owned connections');
 await page.evaluate(()=>{(window as any).mount('none');});await page.waitForFunction(()=>(window as any).disconnectedIds.length===5);assert.ok(!(await page.evaluate(()=>(window as any).disconnectedIds)).includes('99999999-9999-4999-8999-999999999999'));
 console.log('Checking late command connect cleanup and cancellation');
 await page.evaluate(()=>{(window as any).hold=true;(window as any).mount('console');});await input.fill('connect 11111111-1111-4111-8111-111111111111');await input.press('Enter');await page.waitForFunction(()=>(window as any).held.length===1);await page.evaluate(()=>{(window as any).mount('none');});await page.waitForFunction(()=>!document.querySelector('.command-console'));await page.evaluate(()=>{(window as any).held.shift()();});await page.waitForFunction(()=>(window as any).disconnectedIds.length===6);
 await page.evaluate(()=>{(window as any).mount('console');});await input.fill('call slow {}');await input.press('Enter');await page.waitForFunction(()=>(window as any).held.length===1);await page.evaluate(()=>{(window as any).mount('none');});await page.waitForFunction(()=>(window as any).cancelled.length===1);await page.evaluate(()=>{(window as any).held.shift()();});
 console.log('Checking delayed command does not steal another pane focus');
 await page.evaluate(()=>{(window as any).mount('console');const other=document.createElement('textarea');other.setAttribute('aria-label','Other pane draft');document.body.append(other);});
 await input.fill('call slow {}');await input.press('Enter');await page.waitForFunction(()=>(window as any).held.length===1);
 const other=page.getByRole('textbox',{name:'Other pane draft'});await other.fill('Keep writing here');await page.evaluate(()=>{(window as any).held.shift()();});await page.getByRole('log').getByText('完成',{exact:true}).waitFor();
 assert(await other.evaluate(el=>el===document.activeElement),'Delayed completion must preserve focus in another pane');assert.equal(await other.inputValue(),'Keep writing here');
 await input.fill('call slow {}');await input.press('Enter');await page.waitForFunction(()=>(window as any).held.length===1);await page.evaluate(()=>{(window as any).setActive(false);});await other.focus();await page.evaluate(()=>{(window as any).held.shift()();});await page.waitForFunction(()=>!document.querySelector('.command-wait'));
 assert(await other.evaluate(el=>el===document.activeElement),'Inactive console must not focus after completion');
 assert.deepEqual(errors,[]);console.log('Command lifecycle: pending connect cleanup, close ownership, no replay, target/identity draft isolation passed');
}finally{await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(directory,{recursive:true,force:true});}
