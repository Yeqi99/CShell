import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

// No native capture, network desktop, or physical input: delayed bridge/decoder fixture only.
const dir = await mkdtemp(join(tmpdir(), 'desktop-view-races-'));
await build({
  stdin: {
    contents: `
import React,{useState}from'react';import{createRoot}from'react-dom/client';import{AgentDesktopView}from'./src/ui/components/AgentDesktopView';
window.starts=[];window.stops=[];window.releases=[];window.inputs=[];window.acks=[];window.decoders=[];window.pending=[];
window.VideoDecoder=class{constructor(callbacks){this.callbacks=callbacks;this.state='unconfigured';this.decodeQueueSize=0;window.decoders.push(this)}configure(){this.state='configured'}decode(){if(window.decoders.length===1)queueMicrotask(()=>this.callbacks.error(Error('fixture decode error')))}close(){this.state='closed'}};
window.cshell={desktopViewStart:x=>{window.starts.push(x);return new Promise(resolve=>window.pending.push(()=>resolve({id:x.id,control:x.control})))},desktopViewStop:async id=>{window.stops.push(id)},desktopViewRelease:async id=>{window.releases.push(id)},desktopViewInput:async(id,event)=>{window.inputs.push({id,event})},desktopViewAck:async(...args)=>{window.acks.push(args)},desktopViewQuality:async()=>{},onDesktopViewEvent:fn=>{window.receive=fn;return()=>{window.receive=()=>{}}}};
function Fixture(){const[target,setTarget]=useState('A');const[show,setShow]=useState(true);return <><button onClick={()=>setTarget(target==='A'?'B':'A')}>切换目标</button><button onClick={()=>setShow(!show)}>卸载视图</button>{show&&<AgentDesktopView target={target} canView canControl/>}</>};createRoot(document.getElementById('root')).render(<Fixture/>);`,
    resolveDir: process.cwd(),
    loader: 'tsx',
  },
  bundle: true,
  jsx: 'automatic',
  outfile: join(dir, 'fixture.js'),
});
const http = createServer(async (req, res) => {
  const file =
    req.url === '/fixture.js'
      ? 'fixture.js'
      : req.url === '/fixture.css'
        ? 'fixture.css'
        : undefined;
  res.setHeader(
    'Content-Type',
    file?.endsWith('.js') ? 'text/javascript' : file ? 'text/css' : 'text/html',
  );
  res.end(
    file
      ? await readFile(join(dir, file))
      : '<html><head><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>',
  );
});
await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ channel: process.platform==='win32'?'msedge':undefined, headless: true });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(10000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${(http.address() as { port: number }).port}`);
  await page.addStyleTag({content:await readFile('src/ui/styles.css','utf8')});
  const connectButton=page.getByRole('button',{name:'连接桌面',exact:true});
  for(const width of [1280,760,420]){await page.setViewportSize({width,height:800});const before=await connectButton.boundingBox();await page.getByRole('button',{name:'画质',exact:true}).click();const after=await connectButton.boundingBox();assert.ok(Math.abs(before!.y-after!.y)<2,'quality expansion must not vertically move connection controls');assert.equal(await page.locator('.desktop-quality').evaluate(e=>e.scrollWidth<=e.clientWidth+1),true);await page.getByRole('button',{name:'画质',exact:true}).click();}
  await page.setViewportSize({width:1280,height:800});await page.getByRole('button',{name:'画质',exact:true}).click();await page.screenshot({path:'test-results/desktop-quality-layout.png'});await page.getByRole('button',{name:'画质',exact:true}).click();
  await connectButton.click();
  await page.getByRole('button', { name: '切换目标', exact: true }).click();
  await page.evaluate(() => (window as any).pending.shift()());
  assert.equal(await page.getByRole('button', { name: '断开', exact: true }).count(), 0);
  await page.getByRole('button', { name: '连接桌面', exact: true }).click();
  await page.getByRole('button', { name: '取消连接', exact: true }).click();
  await page.evaluate(() => (window as any).pending.shift()());
  assert.equal(await page.getByRole('button', { name: '断开', exact: true }).count(), 0);
  await page.getByLabel('控制键鼠', { exact: true }).check();
  await page.getByRole('button', { name: '连接桌面', exact: true }).click();
  await page.evaluate(() => (window as any).pending.shift()());
  await page.getByRole('button', { name: '断开', exact: true }).waitFor();
  const latest = await page.evaluate(() => (window as any).starts.at(-1));
  await page.locator('canvas').focus();
  await page.keyboard.down('a');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.keyboard.up('a');
  assert.ok(await page.evaluate((id) => (window as any).releases.includes(id), latest.id));
  const frame = {
    id: latest.id,
    type: 'frame',
    key: true,
    data: [0, 0, 0, 1, 0x67, 0x4d, 0, 0x1e],
    sequence: '1',
    timestamp: 1,
  };
  await page.evaluate(
    (e) => (window as any).receive({ ...e, data: new Uint8Array(e.data) }),
    frame,
  );
  await page.getByRole('alert').filter({ hasText: 'fixture decode error' }).waitFor();
  await page.evaluate(
    (e) =>
      (window as any).receive({ ...e, data: new Uint8Array(e.data), sequence: '2', timestamp: 2 }),
    frame,
  );
  assert.equal(await page.evaluate(() => (window as any).decoders.length), 2);
  const ackCount = await page.evaluate(() => (window as any).acks.length);
  await page.evaluate(() => (window as any).decoders[0].callbacks.error(Error('stale decoder')));
  assert.equal(await page.evaluate(() => (window as any).acks.length), ackCount);
  await page.getByRole('status').filter({hasText:'正在使用软件解码恢复'}).waitFor();
  assert.equal(await page.evaluate(() => (window as any).acks.at(-1)[2]), false);
  assert.equal(await page.evaluate(() => (window as any).decoders[1].state), 'closed');
  await page.evaluate(e => (window as any).receive({...e,data:new Uint8Array(e.data),sequence:'3',timestamp:3}), frame);
  assert.equal(await page.evaluate(() => (window as any).decoders.length), 3);
  await page.evaluate(id=>(window as any).receive({id,type:'error',message:'桌面采集未输出首帧，正在切换兼容采集…'}),frame.id);
  await page.getByRole('status').filter({hasText:'正在切换兼容采集'}).waitFor();
  assert.equal(await page.getByRole('alert').filter({hasText:'正在切换兼容采集'}).count(),0);
  await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1024;c.height=768;Object.assign(c,{displayWidth:1024,displayHeight:768,close(){}});(window as any).decoders[2].callbacks.output(c);});
  assert.equal(await page.getByRole('status').filter({hasText:'正在切换兼容采集'}).count(),0);
  assert.equal(await page.getByRole('alert').filter({hasText:'fixture decode error'}).count(),1,'real errors must remain');
  const startsBefore=await page.evaluate(()=>(window as any).starts.length);
  await page.getByRole('button',{name:'填满工作区',exact:true}).click();
  await page.getByRole('button',{name:'还原工作区',exact:true}).waitFor();
  assert.ok(await page.locator('canvas').evaluate(e=>{const c=e.getBoundingClientRect(),s=e.parentElement!.getBoundingClientRect();return c.width<=s.width+1&&c.height<=s.height+1;}));
  await page.getByRole('button',{name:'全屏',exact:true}).click();
  await page.waitForFunction(()=>!!document.fullscreenElement);
  await page.getByRole('button',{name:'退出全屏',exact:true}).click();
  await page.waitForFunction(()=>!document.fullscreenElement);
  await page.getByRole('button',{name:'还原工作区',exact:true}).click();
  assert.equal(await page.evaluate(()=>(window as any).starts.length),startsBefore,'mode switches preserve session');
  await page.evaluate(
    (id) =>
      (window as any).receive({
        id,
        generation: 2,
        type: 'state',
        state: 'reconnecting',
        attempt: 1,
        delayMs: 500,
        control: false,
      }),
    frame.id,
  );
  await page.getByRole('status').filter({ hasText: '正在重连' }).waitFor();
  await page.evaluate(
    (id) => (window as any).receive({ id, generation: 1, type: 'closed', reason: 'stale close' }),
    frame.id,
  );
  await page.getByRole('button', { name: '断开', exact: true }).waitFor();
  await page.evaluate(
    (id) =>
      (window as any).receive({
        id,
        generation: 2,
        type: 'state',
        state: 'connected',
        attempt: 0,
        delayMs: 0,
        control: false,
      }),
    frame.id,
  );
  assert.equal(await page.getByRole('status').filter({hasText:'正在重连'}).count(), 0);
  await page.getByRole('button', { name: '断开', exact: true }).click();
  await page.getByText('画质', { exact: true }).click();
  await page.getByLabel('目标宽度', { exact: true }).fill('2560');
  await page.getByLabel('目标高度', { exact: true }).fill('1440');
  await page.getByLabel('目标帧率', { exact: true }).fill('0');
  const count = await page.evaluate(() => (window as any).starts.length);
  await page.getByRole('button', { name: '连接桌面', exact: true }).click();
  assert.equal(await page.evaluate(() => (window as any).starts.length), count);
  await page.getByLabel('目标帧率', { exact: true }).fill('144');
  await page.getByRole('button', { name: '连接桌面', exact: true }).click();
  await page.getByRole('button', { name: '卸载视图', exact: true }).click();
  await page.evaluate(() => (window as any).pending.shift()());
  const state = await page.evaluate(() => ({
    starts: (window as any).starts,
    stops: (window as any).stops,
  }));
  assert.ok(state.starts.every((s: any) => state.stops.includes(s.id)));
  assert.equal(state.starts.at(-1).quality.width, 2560);
  assert.equal(state.starts.at(-1).quality.fps, 144);
  await page.reload();await page.getByLabel('控制键鼠',{exact:true}).check();await page.getByRole('button',{name:'连接桌面',exact:true}).click();
  await page.evaluate(()=>{const w=window as any;w.receive({id:w.starts.at(-1).id,type:'error',message:'INPUT_DISABLED: 测试输入不可用，保留画面'});w.pending.shift()();});
  await page.locator('p').getByText('测试输入不可用，保留画面',{exact:true}).waitFor();
  // The checkbox retains the user's preference while actual input stays disabled.
  assert.equal(await page.getByLabel('控制键鼠',{exact:true}).isChecked(), true);
  const deniedInputs = await page.evaluate(() => (window as any).inputs.length);
  await page.locator('canvas').focus();
  await page.keyboard.press('a');
  assert.equal(await page.evaluate(() => (window as any).inputs.length), deniedInputs);
  assert.deepEqual(errors, []);
  await writeFile(
    'test-results/desktop-view-races.json',
    JSON.stringify(
      {
        passed: true,
        isolated: true,
        checks: [
          'capture-recovery-notice-cleared-after-draw',
          'real-errors-preserved-after-draw',
          'workspace-and-fullscreen-preserve-session',
          'canvas-fits-screen',
          'input-denial-before-start-resolution-preserved',
          'late-start-target-switch',
          'cancel-pending-start',
          'late-start-unmount',
          'blur-releases-input',
          'decoder-error-keyframe-recovery',
          'silent-decoder-timeout-recovery',
          'stale-decoder-ignored',
          'manual-resolution',
          'invalid-quality-not-sent',
          'visible-reconnect-and-stale-close-ignored',
        ],
      },
      null,
      2,
    ),
  );
  console.log('PASS desktop viewer lifecycle, decoder recovery, input release, quality validation');
} finally {
  await browser.close();
  http.closeAllConnections();
  await new Promise<void>((r) => http.close(() => r()));
  await rm(dir, { recursive: true, force: true });
}

