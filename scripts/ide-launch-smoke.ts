import {build} from 'esbuild';
import {chromium} from 'playwright';
import {readFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const dir=await mkdtemp(join(tmpdir(),'cshell-ide-launch-'));
await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{IdeApp}from'./src/ui/components/IdeApp';window.calls=[];window.cshell={onMachineBrowserFocus:()=>()=>{},machineBrowser:async(id,action,value)=>{window.calls.push({id,action,value});return{tabs:[{id:'tab',title:'Code',url:'http://127.0.0.1:8080/',zoom:1,loading:false,back:false,forward:false}],selected:'tab',connected:true}}};const call=async(method,params)=>{window.calls.push({method,params});if(method==='ide.status')return{ready:true,launchVersion:1};if(method==='ide.start')return{url:'http://127.0.0.1:9999/one-time'};throw Error(method)};createRoot(document.getElementById('root')).render(<IdeApp call={call} target="ssh:11111111-1111-4111-8111-111111111111" active={true}/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,jsx:'automatic',outfile:join(dir,'fixture.js')});
const browser=await chromium.launch({channel:'msedge',headless:true});try{
const page=await browser.newPage({viewport:{width:1100,height:720}});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.abort());await page.setContent('<div id="root" style="height:650px"></div>');await page.addStyleTag({content:await readFile(join(dir,'fixture.css'),'utf8')});await page.addScriptTag({content:await readFile(join(dir,'fixture.js'),'utf8')});
await page.waitForFunction(()=>window['calls'].some(x=>x.action==='navigate'));
const calls=await page.evaluate(()=>window['calls']);assert.equal(calls.filter(x=>x.method==='ide.start').length,1);assert.deepEqual(calls.find(x=>x.method==='ide.start').params,{cwd:''});assert.ok(calls.filter(x=>x.action).every(x=>x.id==='ide@11111111-1111-4111-8111-111111111111'));assert.equal(await page.locator('input:visible').count(),0);assert.equal(await page.locator('.machine-browser-toolbar').isVisible(),false);assert.equal(await page.getByText('应用市场管理').count(),0);assert.deepEqual(errors,[]);console.log('PASS editor launches directly into isolated app surface without setup form or browser toolbar');
}finally{await browser.close();}
