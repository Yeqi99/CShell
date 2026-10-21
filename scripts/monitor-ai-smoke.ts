import {build} from 'esbuild';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const dir=await mkdtemp(join(tmpdir(),'monitor-ai-'));
await build({stdin:{contents:`import React,{useRef}from'react';import{createRoot}from'react-dom/client';import{ViewTerminalMenu}from'./src/ui/components/ViewTerminalMenu';import{MonitorAiAssist}from'./src/ui/components/MonitorAiAssist';
const threads=[];window.calls=[];window.cshell={onAiProvidersChanged:()=>()=>{},onAiThread:()=>()=>{},aiSnapshot:async()=>({providers:[{id:'p',name:'基座',model:'test'}],permissions:[],threads,policy:{},extractionProviderId:null}),aiThreadCreate:async(location,providerId,mode,sessionId)=>{window.calls.push({create:sessionId});if(window.failCreate)throw Error('目标已断开');const t={id:crypto.randomUUID(),location,providerId,mode,sessionId,target:sessionId,messages:[],state:'idle'};threads.push(t);return t;},aiSend:async(id,text)=>window.calls.push({id,text}),copyText:async()=>{}};
function Terminal({id}){const host=useRef(null),terminal=useRef({getSelection:()=>id+' selected output',buffer:{active:{length:1,getLine:()=>({translateToString:()=>id+' recent output'})}}});return <><div ref={host} className="view-terminal" data-id={id} style={{height:70,border:'1px solid #ddd'}}>{id}</div><ViewTerminalMenu host={host} terminal={terminal} sessionId={id} closed={false} onError={console.error}/></>}
createRoot(document.getElementById('root')).render(<><Terminal id="machine-a"/><Terminal id="machine-b"/><Terminal id="machine-c"/><MonitorAiAssist/></>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,outfile:join(dir,'app.js'),jsx:'automatic'});
const server=createServer(async(req,res)=>{const file=req.url?.startsWith('/app.js')?'app.js':req.url?.startsWith('/app.css')?'app.css':'';res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file?'text/css':'text/html');res.end(file?await readFile(join(dir,file)):'<html lang="zh-CN"><head><link rel="stylesheet" href="/app.css"><style>*{box-sizing:border-box}body{margin:0;font:13px system-ui;--panel:white;--border:#ddd;--muted:#667;--accent:#1677ff}button{display:block}button,textarea{font:inherit}[hidden]{display:none!important}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>');});
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1100,height:720}}),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${(server.address() as any).port}/?monitorView=fixture`);
 const analyze=async(id:string)=>{await page.locator('[data-id="'+id+'"]').click({button:'right'});await page.getByRole('menuitem',{name:'AI 分析选中文字',exact:true}).click();};
 await analyze('machine-a');await page.getByLabel('发送给智能体').waitFor();
 await page.waitForFunction(()=>document.querySelector<HTMLTextAreaElement>('[aria-label="发送给智能体"]')?.value.includes('machine-a selected output'));
 assert.deepEqual(await page.evaluate(()=>(window as any).calls),[{create:'machine-a'}],'Analysis must remain an unsent draft');
 await page.getByRole('button',{name:'收起分析',exact:true}).click();await analyze('machine-b');
 await page.waitForFunction(()=>document.querySelector<HTMLTextAreaElement>('[aria-label="发送给智能体"]')?.value.includes('machine-b selected output'));
 assert.deepEqual(await page.evaluate(()=>(window as any).calls),[{create:'machine-a'},{create:'machine-b'}],'A different machine needs a separately bound conversation');
 await page.getByRole('button',{name:'收起分析',exact:true}).click();await page.evaluate(()=>{(window as any).failCreate=true;});await analyze('machine-c');
 await page.getByRole('alert').filter({hasText:'目标已断开'}).waitFor();assert.deepEqual(errors,[]);
 console.log('View context AI: right-click menu, unsent draft, machine binding and visible creation failures passed.');
}finally{await browser.close();server.close();await rm(dir,{recursive:true,force:true});}
