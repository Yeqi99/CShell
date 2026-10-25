import {build} from 'esbuild';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const dir=await mkdtemp(join(tmpdir(),'cshell-pane-'));
await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {OpenCodeView} from './src/extensions/opencode/View';import {AiConversation} from './src/ui/components/AiConversation';import './src/ui/styles.css';import './src/ui/components/ai-panel.css';window.cshell={onAiProvidersChanged:()=>()=>{},aiExtensionCall:async(id,action)=>action==='status'?{accounts:[{id:'default',name:'我的OpenCode账号',workspace:''}]}:action==='catalog'?{choices:[{ref:'default/zen/gemini-4-argon-contributor',model:'gemini-4-argon-contributor',available:true}],current:{ref:'default/zen/gemini-4-argon-contributor',model:'gemini-4-argon-contributor',available:true}}:action==='choices'?[{ref:'default/zen/gemini-4-argon-contributor',model:'gemini-4-argon-contributor',label:'gemini-4-argon-contributor · Zen',available:true}]:action==='models'?[{id:'gemini-4-argon-contributor',available:true},{id:'claude-haiku-5-5',available:true},{id:'beam-free',available:true}]:{}};const noop=()=>{};const snapshot={providers:[{id:'a',name:'OpenCode · 我的模型账号',model:'gemini-4-argon-contributor',extension:{id:'cshell.opencode',model:'default/zen/gemini-4-argon-contributor'}}],threads:[]};createRoot(document.getElementById('root')).render(<div style={{display:'flex',gap:20,padding:10}}><section id="workspace" className="extension-workspace-slot" style={{width:400,height:820,flexShrink:0}}><div className="extension-workbench"><nav className="extension-nav"><h2>扩展</h2><button>插件市场</button><button>应用市场</button></nav><div className="extension-main"><OpenCodeView/></div></div></section><aside id="agent" className="ai-panel" style={{width:400,height:820,flexShrink:0}}><header>智能体</header><AiConversation snapshot={snapshot} location="workspace" providerId="a" mode="review" busy={false} openThread={noop} insertion={null} setProviderId={noop} setMode={noop} create={async()=>({})} run={async f=>f()} configure={noop} executionVisible={false}/></aside></div>);`,resolveDir:process.cwd(),loader:'tsx'},outfile:join(dir,'app.js'),bundle:true,jsx:'automatic',loader:{'.woff2':'dataurl','.svg':'dataurl'}});
const server=createServer(async(req,res)=>{const f=req.url==='/app.js'?'app.js':req.url==='/app.css'?'app.css':null;res.setHeader('Content-Type',f?(f.endsWith('js')?'application/javascript':'text/css'):'text/html; charset=utf-8');res.end(f?await readFile(join(dir,f)):'<link rel="stylesheet" href="app.css"><div id="root"></div><script src="app.js"></script>')});
await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined,headless:true});
try{const page=await browser.newPage({viewport:{width:1600,height:860}});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${(server.address() as any).port}`);await page.getByLabel('账号模型').waitFor();await page.evaluate(()=>{document.documentElement.dataset.theme='light'});
for(const width of [400,550,700]){
 await page.evaluate(width=>{for(const id of ['workspace','agent'])document.getElementById(id)!.style.width=width+'px'},width);
 await page.waitForTimeout(100);
 for(const selector of ['.extension-main','.opencode-model-list','.agent-composer','.agent-composer-tools']){
  assert.equal(await page.locator(selector).evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,`${selector} overflows at ${width}`);
 }
 const controls=await page.locator('.agent-composer-tools > *').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {l:r.left,r:r.right,t:r.top,b:r.bottom}}));
 for(let a=0;a<controls.length;a++)for(let b=a+1;b<controls.length;b++){const x=controls[a],y=controls[b];assert.ok(x.r<=y.l+1||y.r<=x.l+1||x.b<=y.t+1||y.b<=x.t+1,`composer overlap at ${width}`)}
 await page.screenshot({path:`test-results/opencode-agent-pane-${width}.png`});
}
assert.deepEqual(errors,[]);console.log('PASS real 400/550/700px extension and AI panes: no overflow, no composer overlap');
}finally{await browser.close();server.close();await rm(dir,{recursive:true,force:true})}
