import { build } from 'esbuild';
import { _electron as electron } from 'playwright';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'cshell-browser-owner-'));
await build({stdin:{contents:`
import {app,BrowserWindow} from 'electron';
import {EventEmitter} from 'node:events';
import assert from 'node:assert/strict';
import {MachineBrowser} from './src/desktop/machine-browser';
app.setPath('userData',process.env.BROWSER_TEST_DATA!);
app.whenReady().then(async()=>{
 const window=new BrowserWindow({show:false,width:1000,height:800});
 const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'];
 const connections=ids.map(()=>({client:new EventEmitter(),profile:{id:'same-machine',host:'127.0.0.1',port:22,username:'test'},closed:false}));
 const browser=new MachineBrowser(window,{get:(id)=>{const c=connections[ids.indexOf(id)];if(!c||c.closed)throw Error('closed');return c;}} as any);
 try{
  const first=await browser.action(ids[0],'open');
  const second=await browser.action(ids[1],'open');
  assert.equal(second.selected,first.selected,'same machine reuses tabs');
  const bounds={x:0,y:0,width:600,height:400,visible:true};
  await browser.action(ids[1],'bounds',bounds);
  const w=(browser as any).resolved.get(ids[1]);
  const view=w.tabs.get(w.selected).view;
  assert.equal(view.getVisible(),true);
  await browser.action(ids[0],'hide');
  await browser.action(ids[0],'bounds',{...bounds,visible:false});
  assert.equal(view.getVisible(),true,'late inactive workspace must not hide active browser');
  connections[0].closed=true;connections[0].client.emit('close');
  assert.equal((browser as any).owners.size,0,'disconnect releases ownership');
  assert.equal((await browser.action(ids[1],'status')).connected,false,'background status cannot recreate browser');
  const recovered=await browser.action(ids[2],'open');
  assert.equal(recovered.connected,true);
  assert.ok(recovered.tabs.length>0);
  connections[0].client.emit('close');
  assert.equal((await browser.action(ids[2],'status')).connected,true,'old disconnect cannot dispose replacement');
  console.log('PASS browser aliases, late hide, disconnect cleanup, independent reopen');
  (globalThis as any).result={ok:true};
 }catch(e){(globalThis as any).result={error:String(e),stack:e.stack};}
});`,resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',external:['electron'],outfile:join(dir,'main.cjs')});
const env={...process.env,BROWSER_TEST_DATA:join(dir,'data')};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({args:[join(dir,'main.cjs')],env});
try{
 let result:any;
 for(let i=0;i<100;i++){result=await app.evaluate(()=>globalThis['result']);if(result)break;await new Promise(r=>setTimeout(r,100));}
 if(!result?.ok)throw Error(JSON.stringify(result));
 console.log('PASS real Electron browser ownership lifecycle');
}finally{await app.close();}
