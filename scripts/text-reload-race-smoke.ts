import {build} from 'esbuild';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';

// Real editor and CodeMirror, with delayed IPC reads; no real user files.
const bundle=await build({stdin:{contents:`
import React from 'react';import{createRoot}from'react-dom/client';import{PythonEditor}from'./src/ui/components/PythonEditor';
window.reads=[];window.writes=[];
window.cshell={textReadFile:()=>new Promise(resolve=>window.reads.push(resolve)),textSaveFile:async(...args)=>{window.writes.push(args);return {revision:'saved'}}};
createRoot(document.getElementById('root')).render(<PythonEditor sessionId="fixture" path="/note.txt" python="" connected={true} textFile onDependency={()=>{}}/>);
`,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,jsx:'automatic'});
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'application/javascript':'text/html;charset=utf-8');res.end(req.url==='/app.js'?bundle.outputFiles[0].contents:'<!doctype html><div id="root"></div><script src="/app.js"></script>');});
await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
let owned:Awaited<ReturnType<typeof chromium.launchServer>>|undefined;
try{
 owned=await chromium.launchServer({channel:process.platform==='win32'?'msedge':undefined});
 const browser=await chromium.connect(owned.wsEndpoint()),page=await browser.newPage(),errors:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(5000);
 await page.goto('http://127.0.0.1:'+(server.address() as any).port);
 const settle=async(index:number,code:string)=>page.evaluate(({index,code})=>(window as any).reads[index]({code,revision:'revision-'+index}),{index,code});
 await page.waitForFunction(()=>(window as any).reads.length===1);await settle(0,'original');
 const editor=page.locator('.cm-content');await editor.waitFor();
 await page.getByRole('combobox',{name:/^(同步模式|Sync mode)$/}).selectOption('live');
 const reload=page.getByRole('button',{name:/^(重新读取文件|Reload file)$/});
 await reload.click();await page.waitForFunction(()=>(window as any).reads.length===2);
 await editor.fill('new draft during read');await settle(1,'remote replacement');
 await page.waitForFunction(()=>!(document.querySelector('button[aria-label="重新读取文件"],button[aria-label="Reload file"]') as HTMLButtonElement).disabled);
 assert.equal(await editor.innerText(),'new draft during read','delayed remote read must not erase newly typed draft');
 assert.match(await page.getByRole('alert').innerText(),/保留|kept/);
 assert.match(await page.locator('footer').innerText(),/暂停|paused/i);
 assert.equal(await page.evaluate(()=>(window as any).writes.length),0);
 await page.getByRole('combobox',{name:/^(同步模式|Sync mode)$/}).selectOption('save');
 await page.getByRole('button',{name:/^(保存文件|Save file)$/}).click();
 await page.waitForFunction(()=>(window as any).writes.length===1);
 assert.deepEqual(await page.evaluate(()=>(window as any).writes[0]),['fixture','/note.txt','new draft during read','revision-0']);
 await editor.fill('another unsaved draft');
 // Explicitly confirm discarding this draft; without new input the read applies.
 await reload.click();await page.getByRole('button',{name:/^(重新读取|Reload)$/}).click();
 await page.waitForFunction(()=>(window as any).reads.length===3);await settle(2,'accepted remote');
 await page.waitForFunction(()=>document.querySelector('.cm-content')?.textContent==='accepted remote');
 assert.equal(await page.getByRole('alert').count(),0);
 await editor.fill('edited after reload');await page.getByRole('button',{name:/^(保存文件|Save file)$/}).click();
 await page.waitForFunction(()=>(window as any).writes.length===2);
 assert.deepEqual(await page.evaluate(()=>(window as any).writes[1]),['fixture','/note.txt','edited after reload','revision-2']);
 assert.deepEqual(errors,[]);
 console.log('PASS reload preserves concurrent edits, explicit retry applies, next save uses accepted revision');
}finally{await owned?.kill();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
