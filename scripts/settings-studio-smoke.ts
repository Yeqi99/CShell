import {build} from 'esbuild';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdir,mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
const dir=await mkdtemp(join(tmpdir(),'settings-studio-'));
await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
import React,{useState,useCallback} from 'react';import {createRoot} from 'react-dom/client';
import './src/ui/styles.css';import {Settings} from './src/ui/components/Settings';import {defaults} from './src/shared/contracts';
const settings={enabled:false,port:3777,allowedProfiles:[],allowCommands:false,capabilities:[],clients:[],targetPolicies:{},allowedLocalShells:[],localFileRoots:[],review:'always'};
window.actions=[];window.cshell=new Proxy({
systemFonts:async()=>['Segoe UI','Consolas'],presets:async()=>[],
mcpStatus:async()=>({revision:'test',settings,running:false}),mcpConfigure:async s=>{window.actions.push('mcp-save');return {revision:'next',settings:s,running:false}},
config:async()=>({profiles:[{id:'11111111-1111-4111-8111-111111111111',name:'测试 Linux 工作机',host:'192.0.2.10',protocol:'ssh'},{id:'22222222-2222-4222-8222-222222222222',name:'较长名称的远程开发环境',host:'example.invalid',protocol:'client'}]}),
apiLocalShells:async()=>[],localEnvironment:async()=>({overrides:[],inherited:[{name:'EXAMPLE',value:'isolated'}]}),
networkStatus:async()=>({route:{mode:'system'},machines:[]}),networkSave:async route=>{window.actions.push('network-save');return {route,machines:[]}},networkRemoteSources:async()=>[],
updateState:async()=>({phase:'current',current:'0.8.17',platform:'win32',automatic:true}),usageRead:async()=>({enabled:false}),
cloudStatus:async()=>({state:'signed-out',email:null}),
}, {get:(o,k)=>k in o?o[k]:String(k).startsWith('on')?()=>()=>{}:()=>new Promise(()=>{})});
function Fixture(){const [v,setV]=useState(defaults);const preview=useCallback(p=>{if(p){window.preview=p;document.documentElement.dataset.theme=p.theme;}},[]);return <main id="fixture" style={{height:'100vh',width:'100%'}}><Settings value={v} layout={v.layout} onPreview={preview} onSave={async p=>{setV(p);window.saved=p;}} onClose={()=>window.actions.push('close')}/></main>};createRoot(document.getElementById('root')).render(<Fixture/>);
`},bundle:true,jsx:'automatic',outfile:join(dir,'app.js'),loader:{'.svg':'dataurl','.woff2':'dataurl','.png':'dataurl'}});
const server=createServer(async(req,res)=>{const n=req.url==='/app.js'?'app.js':req.url==='/app.css'?'app.css':null;res.setHeader('Content-Type',n?n.endsWith('css')?'text/css':'text/javascript':'text/html; charset=utf-8');res.end(n?await readFile(join(dir,n)):'<html data-theme="light"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script></html>');});
await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined});
try{const page=await browser.newPage({viewport:{width:1100,height:840}});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+(server.address() as any).port);const nav=page.locator('.settings-nav');await nav.getByRole('button',{name:'外观',exact:true}).waitFor();await mkdir('test-results/settings-studio',{recursive:true});
 const labels=await nav.getByRole('button').allTextContents();
 for(const width of [1100,680,380]){await page.setViewportSize({width,height:840});for(const label of labels){await nav.getByRole('button',{name:label,exact:true}).click();await page.screenshot({path:'test-results/settings-studio/'+width+'-'+label+'.png'});assert(await page.locator('.settings-content').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'Content overflow '+width+' '+label);const footer=await page.locator('.settings-savebar').boundingBox();assert(footer&&footer.y+footer.height<=841,'Footer clipped');}}
 await page.setViewportSize({width:1100,height:840});await nav.getByRole('button',{name:'终端',exact:true}).click();await page.getByLabel('终端字号',{exact:true}).fill('17');await nav.getByRole('button',{name:'AI 与安全',exact:true}).click();await page.getByRole('button',{name:'一键全选所有权限',exact:true}).click();assert.deepEqual(await page.evaluate(()=>(window as any).actions),[],'Viewing/editing must not save or authorize');
 await nav.getByRole('button',{name:'终端',exact:true}).click();assert.equal(await page.getByLabel('终端字号',{exact:true}).inputValue(),'17');
 await page.getByRole('searchbox').fill('MCP');assert.deepEqual(await nav.getByRole('button').allTextContents(),['AI 与安全']);await nav.getByRole('button',{name:'AI 与安全',exact:true}).click();await page.getByRole('searchbox').fill('');await page.locator('.settings-savebar .primary').click();assert.equal(await page.evaluate(()=>(window as any).saved.fontSize),17);assert((await page.evaluate(()=>(window as any).actions)).includes('mcp-save'));
 await nav.getByRole('button',{name:'外观',exact:true}).click();await page.getByRole('combobox',{name:'外观',exact:true}).selectOption('dark');await page.screenshot({path:'test-results/settings-studio/dark.png'});assert.deepEqual(errors,[]);console.log('PASS all settings categories at 1100/680/380px, dark preview, search, retained drafts, explicit permission save and fixed footer');
}finally{await browser.close();server.close();await rm(dir,{recursive:true,force:true});}
