import { build } from 'esbuild';
import { chromium } from 'playwright';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const dir = await mkdtemp(join(tmpdir(), 'cshell-browser-lifecycle-'));
await build({ stdin: { contents: `
import React from 'react';import {createRoot} from 'react-dom/client';
import {MachineBrowser} from './src/ui/components/MachineBrowser';
const root=createRoot(document.getElementById('root'));
window.calls=[];window.pending=[];
window.cshell={onMachineBrowserFocus:()=>()=>{},machineBrowser:(id,action,value)=>{
 window.calls.push({id,action,value});
 if(action==='open')return new Promise((resolve,reject)=>window.pending.push({id,resolve,reject}));
 return Promise.resolve({tabs:[],selected:'',connected:true});
}};
window.show=(target,url)=>root.render(<MachineBrowser target={target} name={target} active={true} appUrl={url}/>);
window.show('old');`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, jsx: 'automatic', outfile: join(dir, 'fixture.js') });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
 const page = await browser.newPage();
 await page.route('**/*', r => r.abort());
 await page.setContent('<div id="root"></div>');
 await page.addScriptTag({content: await readFile(join(dir,'fixture.js'),'utf8')});
 await page.waitForFunction(()=>window['pending'].length===1);
 await page.evaluate(()=>window['show']('new'));
 await page.waitForFunction(()=>window['pending'].length===2);
 await page.evaluate(()=>window['pending'][0].reject(Error('obsolete error')));
 await page.waitForTimeout(30);
 assert.equal(await page.getByText('obsolete error',{exact:false}).count(),0);
 await page.evaluate(()=>window['show']('failed','http://127.0.0.1/launch'));
 await page.waitForFunction(()=>window['pending'].length===3);
 await page.evaluate(()=>window['pending'][2].reject(Error('open failed')));
 await page.getByRole('alert').waitFor();
 assert.equal(await page.evaluate(()=>window['calls'].filter(x=>x.action==='navigate').length),0);
 await page.evaluate(()=>window['show']('failed','http://127.0.0.1/retry'));
 await page.waitForFunction(()=>window['pending'].length===4);
 await page.evaluate(()=>window['pending'][3].resolve({tabs:[],selected:'',connected:true}));
 await page.waitForFunction(()=>window['calls'].some(x=>x.action==='navigate'&&x.value.endsWith('/retry')));
 console.log('PASS stale target errors ignored, failed open does not navigate, refreshed app URL retries');
} finally { await browser.close(); }
