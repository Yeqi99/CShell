import {desktopTestTarget} from './desktop-test-target';
const expectedTarget=desktopTestTarget();
/** Isolated Electron viewer against the explicitly deployed test host.
 * --prepare-only builds the fixture without opening any remote connection. */
import { build } from 'esbuild';
import { _electron as electron } from 'playwright';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { fingerprint } from '../src/core/client/identity';

const receipt = z
  .object({
    deviceId: z.string().uuid(),
    host: z.literal(expectedTarget.host),
    port: z.literal(expectedTarget.port),
    certificate: z.string(),
    fingerprint: z.string(),
    expiresAt: z.string().optional(),
  })
  .passthrough()
  .parse(JSON.parse(await readFile('test-results/desktop-server-receipt.json', 'utf8')));
assert.equal(
  fingerprint(receipt.certificate),
  receipt.fingerprint,
  'receipt certificate pin must match',
);
const directory = await mkdtemp(join(tmpdir(), 'cagent-public-viewer-'));
const vaultDirectory = resolve('test-results/desktop-test-controller');
const evidenceFile = 'test-results/desktop-public-viewer.json';
let instance: Awaited<ReturnType<typeof electron.launch>> | undefined;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const quantile = (values: number[], fraction: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length
    ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]
    : null;
};
try {
  await build({
    stdin: {
      contents: `import React from 'react';import{createRoot}from'react-dom/client';import{AgentDesktopView}from'./src/ui/components/AgentDesktopView';createRoot(document.getElementById('root')).render(<AgentDesktopView target="public-test" canView={true} canControl={false}/>);`,
      resolveDir: process.cwd(),
      loader: 'tsx',
    },
    bundle: true,
    jsx: 'automatic',
    outfile: join(directory, 'view.js'),
  });
  await writeFile(
    join(directory, 'index.html'),
    '<html><head><link rel="stylesheet" href="view.css"></head><body><div id="root"></div><script src="view.js"></script></body></html>',
  );
  await build({
    entryPoints: ['src/desktop/preload.ts'],
    platform: 'node',
    bundle: true,
    external: ['electron'],
    outfile: join(directory, 'preload.cjs'),
  });
  const main = `import{app,BrowserWindow,ipcMain}from'electron';import{DesktopViews}from'./src/core/desktop-views';import{ClientProvider}from'./src/core/client/provider';import{ClientVault}from'./src/core/client/identity';import{agentCodec}from'./src/agent/storage';import{connectDesktop}from'./src/core/desktop-client';
 app.setPath('userData',${JSON.stringify(join(directory, 'data'))});
 const receipt=${JSON.stringify({ deviceId: receipt.deviceId, host: receipt.host, port: receipt.port, fingerprint: receipt.fingerprint, expiresAt: receipt.expiresAt })};
 const stats={frames:0,decoded:0,nack:0,bytes:0,states:[],closed:[],frameTimes:[],decodeMs:[],deliveryAckMs:[],queueEstimateMs:[],tickets:0,inputAttempts:0,forcedAt:undefined,video:undefined};
 const pending=new Map();let provider,views,stream,win;
 globalThis.fixture={stats,disconnect:()=>{if(!stream||stream.destroyed)throw Error('No active test stream');stats.forcedAt=Date.now();stream.destroy();},shutdown:async()=>{await views?.dispose();provider?.dispose();}};
 app.whenReady().then(async()=>{
  if(receipt.expiresAt&&Date.parse(receipt.expiresAt)<=Date.now())throw Error('Deployment receipt expired; redeploy first');
  const vault=new ClientVault(${JSON.stringify(vaultDirectory)},await agentCodec(${JSON.stringify(vaultDirectory)}));provider=new ClientProvider(vault,()=>{});await provider.load();
  const authorize=()=>{const device=provider.list().find(d=>d.deviceId===receipt.deviceId);if(!device||device.fingerprint!==receipt.fingerprint||device.host!==receipt.host||device.port!==receipt.port)throw Error('Paired test device does not match deployment receipt');};authorize();
  win=new BrowserWindow({show:false,width:1000,height:760,webPreferences:{preload:${JSON.stringify(join(directory, 'preload.cjs'))},contextIsolation:true,sandbox:true,backgroundThrottling:false}});
  views=new DesktopViews({authorize,open:async input=>{
   const ticket=await provider.call(receipt.deviceId,{method:'desktop.open',params:{control:false,quality:input.quality,transport:'management'}},AbortSignal.timeout(15000));stats.tickets++;
   return{ticket,identity:receipt.deviceId,host:receipt.host,local:false,connect:async()=>{authorize();const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),15000);try{stream=await provider.openDesktopStream(receipt.deviceId,abort.signal);try{return await connectDesktop(ticket,{host:receipt.host,expectedHostIdentity:receipt.deviceId,stream});}catch(e){stream.destroy();throw e;}}finally{clearTimeout(timer);}},close:()=>provider.call(receipt.deviceId,{method:'desktop.close',params:{id:ticket.id}},AbortSignal.timeout(3000))};
  },publish:e=>{
   if(e.type==='frame'){stats.frames++;stats.bytes+=e.data.length;stats.frameTimes.push(Date.now());pending.set(e.generation+':'+e.sequence,performance.now());if(pending.size>16)pending.delete(pending.keys().next().value);}
   if(e.type==='config')stats.video=e.info;
   if(e.type==='state'){stats.states.push({state:e.state,generation:e.generation,attempt:e.attempt,at:Date.now()});pending.clear();}
   if(e.type==='closed')stats.closed.push({reason:e.reason,at:Date.now()});
   if(!win.isDestroyed())win.webContents.send('desktop:view-event',e);
  }});
  ipcMain.handle('desktop:view-start',(_,input)=>{if(input.target!=='public-test'||input.control)throw Error('Read-only test target required');return views.start(input);});
  ipcMain.handle('desktop:view-stop',(_,id)=>views.stop(id));ipcMain.handle('desktop:view-release',(_,id,g)=>views.release(id,g));ipcMain.handle('desktop:view-quality',(_,id,q,g)=>views.quality(id,q,g));
  ipcMain.handle('desktop:view-input',()=>{stats.inputAttempts++;throw Error('Remote input is prohibited in this fixture');});
  ipcMain.handle('desktop:view-ack',(_,id,seq,ok,ms,g)=>{if(ok)stats.decoded++;else stats.nack++;stats.decodeMs.push(ms);const key=g+':'+seq,at=pending.get(key);if(at!==undefined){const elapsed=performance.now()-at;stats.deliveryAckMs.push(elapsed);stats.queueEstimateMs.push(Math.max(0,elapsed-ms));pending.delete(key);}return views.ack(id,seq,ok,ms,g);});
  await win.loadFile(${JSON.stringify(join(directory, 'index.html'))});
 }).catch(e=>{stats.closed.push({reason:String(e),at:Date.now()});console.error(String(e));app.quit();});app.on('window-all-closed',()=>app.quit());`;
  await build({
    stdin: { contents: main, resolveDir: process.cwd(), loader: 'ts' },
    platform: 'node',
    bundle: true,
    external: ['electron'],
    outfile: join(directory, 'main.cjs'),
  });
  if (process.argv.includes('--prepare-only'))
    console.log(
      'Prepared public viewer fixture: production preload/viewer bundled; no remote connection opened.',
    );
  else {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    instance = await electron.launch({ args: [join(directory, 'main.cjs')], env, timeout: 30000 });
    const page = await instance.firstWindow();
    page.setDefaultTimeout(45000);
    // Count actual canvas draws without persisting or reading any pixels.
    await page.evaluate(() => {
      const state = { draws: 0, times: [] as number[] };
      (window as any).renderStats = state;
      const original = CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage = function (...args: any[]) {
        const result = (original as any).apply(this, args);
        state.draws++;
        state.times.push(Date.now());
        return result;
      };
    });
    const clickAt = Date.now();
    await page.getByRole('button', { name: '连接桌面', exact: true }).click();
    await page.waitForFunction(() => (window as any).renderStats.draws > 0);
    const firstRenderedAt = Date.now(),
      started = Date.now();
    await sleep(7000);
    await instance.evaluate(() => (globalThis as any).fixture.disconnect());
    await sleep(Math.max(0, 20000 - (Date.now() - started)));
    const sampleEnd = Date.now();
    const report = await instance.evaluate(() => ({
      stats: (globalThis as any).fixture.stats,
      versions: process.versions,
    }));
    const rendered = await page.evaluate(
      () => (window as any).renderStats as { draws: number; times: number[] },
    );
    const { frameTimes, decodeMs, deliveryAckMs, queueEstimateMs, ...stats } = report.stats;
    const sampleFrames = frameTimes.filter((t: number) => t >= started && t <= sampleEnd).length;
    const sampleRendered = rendered.times.filter((t) => t >= started && t <= sampleEnd).length;
    const reconnectState = stats.states.find(
      (s: any) => s.state === 'connected' && s.at >= stats.forcedAt,
    );
    const firstAfterRecovery = rendered.times.find((t) => reconnectState && t >= reconnectState.at);
    const evidence = {
      ok: false,
      time: new Date().toISOString(),
      server: receipt.host,
      managementPort: receipt.port,
      observedMs: sampleEnd - started,
      firstRenderedMs: firstRenderedAt - clickAt,
      sampleFrames,
      sampleRendered,
      renderedFps: (sampleRendered * 1000) / (sampleEnd - started),
      framesInLast2500ms: frameTimes.filter((t: number) => t > sampleEnd - 2500).length,
      renderedInLast2500ms: rendered.times.filter((t) => t > sampleEnd - 2500).length,
      reconnectToFirstRenderedMs:
        firstAfterRecovery === undefined ? null : firstAfterRecovery - stats.forcedAt,
      stats,
      decodeMs: { p50: quantile(decodeMs, 0.5), p95: quantile(decodeMs, 0.95) },
      mainToRendererAckMs: {
        p50: quantile(deliveryAckMs, 0.5),
        p95: quantile(deliveryAckMs, 0.95),
      },
      ipcQueueEstimateMs: {
        p50: quantile(queueEstimateMs, 0.5),
        p95: quantile(queueEstimateMs, 0.95),
      },
      versions: report.versions,
      inputInjected: false,
      pixelsPersisted: false,
      publicNetworkTested: true,
      transport: 'actual Electron IPC/preload + paired public Agent TLS management stream',
      latencyScope:
        'Decode and local delivery/ACK only; capture-to-display latency is not measured across unsynchronized host clocks.',
      faultScope:
        'One dedicated desktop stream intentionally disconnected; not a whole network outage.',
    };
    await writeFile(evidenceFile, JSON.stringify(evidence, null, 2));
    assert.equal(stats.inputAttempts, 0);
    assert.deepEqual(stats.closed, []);
    assert.ok(stats.tickets >= 2, 'fresh authorization ticket after disconnect');
    assert.ok(
      stats.states.some((s: any) => s.state === 'reconnecting') && reconnectState,
      'automatic reconnect',
    );
    assert.ok(sampleRendered > 10, 'multiple actual canvas draws');
    assert.ok(evidence.renderedInLast2500ms > 1, 'rendering continues at end');
    assert.notEqual(firstAfterRecovery, undefined, 'new frames rendered after reconnect');
    await page.getByRole('button', { name: '断开', exact: true }).click();
    evidence.ok = true;
    await writeFile(evidenceFile, JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence));
  }
} catch (error) {
  const prior = await readFile(evidenceFile, 'utf8')
    .then(JSON.parse)
    .catch(() => undefined);
  const stats = await instance
    ?.evaluate(() => (globalThis as any).fixture?.stats)
    .catch(() => undefined);
  await writeFile(
    evidenceFile,
    JSON.stringify(
      {
        ok: false,
        time: new Date().toISOString(),
        error: String(error),
        stats,
        measurement:
          prior?.time && Date.now() - Date.parse(prior.time) < 120000 ? prior : undefined,
        inputInjected: false,
        pixelsPersisted: false,
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  if (instance) {
    await instance
      .evaluate(async () => {
        await (globalThis as any).fixture?.shutdown();
      })
      .catch(() => {});
    await instance.close();
  }
  await rm(directory, { recursive: true, force: true });
}
