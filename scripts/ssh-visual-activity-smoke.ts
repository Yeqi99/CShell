import {build} from 'esbuild';
import {chromium} from 'playwright';
import {mkdtemp, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';

const directory = await mkdtemp(join(tmpdir(), 'cshell-visual-activity-'));
await build({stdin: {resolveDir: process.cwd(), loader: 'tsx', contents: `
import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {LinuxWorkspace} from './src/ui/components/LinuxWorkspace';
import {MonitorPanel} from './src/ui/components/MonitorPanel';
import {defaults} from './src/shared/contracts';
import './src/ui/styles.css';
window.polls=0;window.fileMounts=0;window.terminalMounts=0;window.storageWrites=0;
const setItem=Storage.prototype.setItem;
Storage.prototype.setItem=function(key,value){if(key.endsWith(':windows'))window.storageWrites++;return setItem.call(this,key,value)};
window.cshell={
 linuxWorkspacePlan:async()=>({installed:false,installDirectory:'/fixture/cagent',platform:'Linux',arch:'x86_64',user:'fixture',steps:[]}),
 monitor:async()=>{window.polls++;return {cpu:1,cpuCount:4,memory:10,memoryUsed:1,memoryTotal:10,disk:10,diskUsed:1,diskTotal:10,latency:1}},
 resourceHardware:async()=>({gpus:[]})
};
function Files({active}){const[draft,setDraft]=useState('');useEffect(()=>{window.fileMounts++},[]);return <div data-file-active={String(active)}><input aria-label="file draft" value={draft} onChange={e=>setDraft(e.target.value)}/><MonitorPanel sessionId="fixture" active={active}/></div>}
function Terminal(){const[draft,setDraft]=useState('');useEffect(()=>{window.terminalMounts++},[]);return <input aria-label="terminal draft" value={draft} onChange={e=>setDraft(e.target.value)}/>}
function Fixture(){const[active,setActive]=useState(true),[closed,setClosed]=useState(false);window.fixtureActive=setActive;window.fixtureClosed=setClosed;return <div style={{height:720,width:1100}}><LinuxWorkspace session="fixture" profileId="fixture-machine" name="Fixture" active={active} closed={closed} onTerminal={()=>{}} preferences={defaults} files={visible=><Files active={visible}/>} terminal={()=><Terminal/>}/></div>}
createRoot(document.getElementById('app')).render(<Fixture/>);
`}, loader:{'.svg':'dataurl','.png':'dataurl','.woff2':'dataurl'}, bundle:true, jsx:'automatic', outfile:join(directory,'fixture.js')});
const browser = await chromium.launch({channel:'msedge'});
try {
  const page = await browser.newPage({viewport:{width:1200,height:820}});
  const errors:string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.install();
  await page.route('https://fixture.invalid/', route => route.fulfill({body:'<div id="app"></div>',contentType:'text/html'}));
  await page.goto('https://fixture.invalid/');
  await page.addStyleTag({content:await readFile(join(directory,'fixture.css'),'utf8')});
  await page.addScriptTag({content:await readFile(join(directory,'fixture.js'),'utf8')});
  const polls = () => page.evaluate(() => (window as any).polls);
  const tick = async () => {await page.clock.runFor(5100);};
  const assertPaused = async () => {const count=await polls();await tick();assert.equal(await polls(),count);};
  const fileWindow = page.getByRole('region',{name:'文件窗口',exact:true});
  const openFiles = async () => {
    await page.locator('[data-desktop-icon="files"]').dblclick();
    await page.locator('[data-file-active="true"]').waitFor();
  };
  await openFiles();
  await page.getByLabel('file draft').fill('preserve file draft');
  const first = await polls();await tick();assert.equal(await polls(),first+1);
  await fileWindow.getByRole('button',{name:'最小化文件',exact:true}).click();
  await page.locator('[data-file-active="false"]').waitFor({state:'attached'});
  await assertPaused();
  await openFiles();
  assert.equal(await page.getByLabel('file draft').inputValue(),'preserve file draft');
  await fileWindow.getByRole('button',{name:'关闭文件窗口',exact:true}).click();
  await assertPaused();
  await openFiles();

  // Switching to another app, tab, original view or disconnected state pauses polling,
  // while the mounted file view and existing terminal retain their drafts.
  await page.locator('[data-desktop-icon="terminal"]').dblclick();
  await page.getByLabel('terminal draft').fill('preserve terminal draft');
  await assertPaused();
  await openFiles();
  await page.evaluate(() => (window as any).fixtureActive(false));
  await assertPaused();
  await page.evaluate(() => (window as any).fixtureActive(true));
  await page.locator('[data-file-active="true"]').waitFor();
  await page.evaluate(() => (window as any).fixtureClosed(true));
  await assertPaused();
  await page.evaluate(() => (window as any).fixtureClosed(false));
  await page.locator('[data-file-active="true"]').waitFor();
  assert.equal(await page.getByLabel('file draft').inputValue(),'preserve file draft');
  assert.equal(await page.getByLabel('terminal draft').inputValue(),'preserve terminal draft');
  assert.equal(await page.evaluate(() => (window as any).fileMounts),1);
  assert.equal(await page.evaluate(() => (window as any).terminalMounts),1);

  // Many same-frame pointer events produce one geometry update and no storage IO.
  const titlebar = fileWindow.locator('.desktop-titlebar');
  const titleBounds = (await titlebar.boundingBox())!;
  await page.mouse.move(titleBounds.x+100,titleBounds.y+15);await page.mouse.down();
  await page.evaluate(() => { (window as any).storageWrites=0; });
  await page.evaluate(({x,y}) => {
    const canvas=document.querySelector('.desktop-canvas')!;
    for(let i=1;i<=60;i++)canvas.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:1,clientX:x+i,clientY:y+10}));
  },{x:titleBounds.x+100,y:titleBounds.y+15});
  await page.clock.runFor(40);
  assert.equal(await page.evaluate(() => (window as any).storageWrites),0);
  assert((await fileWindow.boundingBox())!.x>titleBounds.x);
  await page.mouse.up();
  await page.clock.runFor(40);
  await page.waitForFunction(() => (window as any).storageWrites===1);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('cshell-linux-desktop:fixture-machine:windows')!).find((w:any)=>w.id==='files'));
  const moved = (await fileWindow.boundingBox())!;
  assert(Math.abs(saved.x-moved.x)<2);

  // Resize has the same deferred persistence and cancellation flushes its final geometry.
  const resize=fileWindow.getByRole('button',{name:'调整文件窗口大小',exact:true});
  const handle=(await resize.boundingBox())!;
  await page.mouse.move(handle.x+5,handle.y+5);await page.mouse.down();
  await page.evaluate(() => { (window as any).storageWrites=0; });
  await page.mouse.move(handle.x-45,handle.y-35,{steps:8});
  assert.equal(await page.evaluate(() => (window as any).storageWrites),0);
  await page.locator('.desktop-canvas').dispatchEvent('pointercancel',{pointerId:1});
  await page.clock.runFor(40);
  await page.waitForFunction(() => (window as any).storageWrites===1);
  await page.mouse.up();
  const finalSize = await page.evaluate(() => JSON.parse(localStorage.getItem('cshell-linux-desktop:fixture-machine:windows')!).find((w:any)=>w.id==='files'));
  assert(finalSize.w<saved.w);
  assert.equal(await page.getByLabel('file draft').inputValue(),'preserve file draft');
  assert.deepEqual(errors,[]);
  console.log('PASS: polling pauses for hidden/minimized/closed/background/disconnected file windows; drafts and mounts preserved; drag/resize coalesce per frame and persist on end/cancel.');
} finally { await browser.close(); }
