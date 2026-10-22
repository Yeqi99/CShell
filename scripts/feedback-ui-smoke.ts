import {build} from 'esbuild';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp,readFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const dir=await mkdtemp(join(tmpdir(),'cshell-feedback-ui-'));
await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{ErrorNotice}from'./src/ui/components/ErrorNotice';import{AiStreamingMarkdown}from'./src/ui/components/AiStreamingMarkdown';
import './src/ui/theme.css';
window.cshell={copyText:async text=>{window.copied=text}};
function Fixture(){const[text,setText]=useState('');const[running,setRunning]=useState(true);window.append=text=>setText(text);window.stop=()=>setRunning(false);return <main style={{maxWidth:680,margin:'32px auto',padding:8}}><h2>智能体</h2><ErrorNotice title="这次回复未完成" error="Error: Error invoking remote method 'agent:call': AI API HTTP 503" retry={()=>window.retried=true}/><div id="stream"><AiStreamingMarkdown text={text} streaming={running} onReveal={()=>{}}/></div></main>};createRoot(document.getElementById('root')).render(<Fixture/>);`},bundle:true,jsx:'automatic',outfile:join(dir,'fixture.js')});
const server=createServer(async(req,res)=>{const file=req.url==='/fixture.js'?'fixture.js':req.url==='/fixture.css'?'fixture.css':null;res.setHeader('content-type',file?.endsWith('.js')?'application/javascript':file?'text/css':'text/html');res.end(file?await readFile(join(dir,file)):'<!doctype html><html><meta charset="utf-8"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>');});
await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+(server.address() as any).port);
 await page.getByRole('alert').waitFor();await page.getByRole('button',{name:'重试'}).click();assert.ok(await page.evaluate(()=>(window as any).retried));
 await page.getByText('诊断详情',{exact:true}).click();await page.getByRole('button',{name:'复制内容'}).click();assert.equal(await page.evaluate(()=>(window as any).copied),'AI API HTTP 503');
 const text='这是连续输出的中文内容。🙂 '.repeat(40);
 await page.evaluate(text=>(window as any).append(text),text);
 await page.waitForTimeout(50);const partial=await page.locator('#stream').innerText();assert.ok(partial.length>0&&partial.length<text.length,'buffer reveals part of a burst');assert.ok(!/[\uD800-\uDBFF]$/.test(partial));
 await page.evaluate(()=>(window as any).stop());await page.waitForTimeout(40);assert.equal((await page.locator('#stream').innerText()).trim(),text.trim(),'stop shows all received content');
 await mkdir('.local/feedback-ui',{recursive:true});
 for(const width of [1200,390]){await page.setViewportSize({width,height:820});await page.screenshot({path:'.local/feedback-ui/'+width+'.png',fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');}
 assert.deepEqual(errors,[]);console.log('Feedback, copy, retry, stream smoothing, stop, and narrow layout passed');
}finally{await browser.close();server.close();}
