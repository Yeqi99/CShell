import {build} from 'esbuild';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile,mkdtemp,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const dir=await mkdtemp(join(tmpdir(),'member-model-render-'));
await build({entryPoints:['src/ui/markdown-worker.ts'],outfile:join(dir,'worker.js'),bundle:true,format:'iife',conditions:['worker']});
await build({stdin:{contents:`import React,{useState} from 'react';import{createRoot}from'react-dom/client';import {AiStreamingMarkdown} from './src/ui/components/AiStreamingMarkdown';import Markdown from 'react-markdown';import remarkGfm from 'remark-gfm';import './src/ui/styles.css';
function App(){const [state,set]=useState({text:'',done:false,name:''});window.showReply=set;return <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:24,padding:24,height:'100vh',overflow:'auto'}}><section id="left"><h2>cagent · {state.name}</h2>{state.done?<Markdown remarkPlugins={[remarkGfm]}>{state.text}</Markdown>:<AiStreamingMarkdown text={state.text} streaming onReveal={()=>{}}/>}</section><section id="right"><h2>CShell · {state.name}</h2><AiStreamingMarkdown text={state.text} streaming={!state.done} onReveal={()=>{}}/></section></div>};createRoot(document.getElementById('root')).render(<App/>);`,loader:'tsx',resolveDir:process.cwd()},outfile:join(dir,'app.js'),bundle:true,jsx:'automatic',define:{__ANDROID_MARKDOWN_WORKER__:JSON.stringify('/worker.js')},loader:{'.woff2':'dataurl'}});
const server=createServer(async(req,res)=>{const name=['/app.js','/worker.js','/app.css'].includes(req.url??'')?req.url!.slice(1):'';res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name?'text/css':'text/html');res.end(name?await readFile(join(dir,name)):'<html data-theme="light"><meta charset="utf-8"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script></html>');});
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'msedge'});
try{const page=await browser.newPage({viewport:{width:1100,height:740}});const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',msg=>{if(msg.type()==='error')console.log('BROWSER',msg.text())});await page.addInitScript(()=>{const Original=window.Worker;window.Worker=class extends Original {constructor(url:any,options?:any){super(url,options);this.addEventListener('error',e=>console.error('WORKER',e.message));}};});await page.goto('http://127.0.0.1:'+(server.address() as any).port);await page.waitForFunction(()=>typeof(window as any).showReply==='function');
const records=JSON.parse(await readFile('test-results/member-model-live.json','utf8')).results;
await mkdir('test-results/member-models',{recursive:true});
for(const [i,row] of records.entries()){if(i<Number(process.argv[2]??0)||!row.answer)continue;for(const fraction of [0.25,0.65,1]){const text=row.answer.slice(0,Math.ceil(row.answer.length*fraction));await page.evaluate(({text,name,done})=>(window as any).showReply({text,name,done}),{text,name:row.name,done:fraction===1});await page.waitForFunction(text=>['left','right'].every(id=>document.getElementById(id)?.textContent?.includes(text.replace(/[*`#_]/g,'').trim().slice(-8))),text);}
await page.locator('#right .agent-markdown p').filter({hasText:'会员基座验证完成'}).waitFor();
for(const selector of ['#left','#right'])assert(await page.locator(selector).evaluate(el=>el.scrollWidth<=el.clientWidth+1));
await page.screenshot({path:'test-results/member-models/'+String(i+1).padStart(2,'0')+'.png'});
console.log('RENDER PASS '+row.name);}
assert.deepEqual(errors,[]);
}finally{await browser.close();server.close();}
