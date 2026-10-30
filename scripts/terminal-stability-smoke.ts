import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

// Actual TerminalPane/xterm, ANSI output, wheel and scrollbar dragging. No remote credentials.
const dir = await mkdtemp(join(tmpdir(), 'terminal-stability-'));
await build({
  stdin: {
    contents: `
    import React, { Profiler } from 'react';
    import { createRoot } from 'react-dom/client';
    import { Terminal } from '@xterm/xterm';
    import './src/ui/theme.css';import './src/ui/styles.css';
    import { TerminalPane } from './src/ui/components/TerminalPane';
    import { defaults } from './src/shared/contracts';
    import { initialPlugins } from './src/shared/plugins';
    const open = Terminal.prototype.open;
    Terminal.prototype.open = function(...args) { window.term = this; return open.apply(this,args); };
    window.cshell = new Proxy({
      onAiProvidersChanged: () => () => {},
      aiSnapshot: async () => ({providers: [], extractionProviderId:null}),
    }, {get:(target,key)=>target[key] || (async()=>{})});
    window.resizes=[];window.cshell.resize=async(id,cols,rows)=>window.resizes.push({cols,rows});window.commits = 0;
    window.armed = false;
    window.root = createRoot(document.getElementById('root'));
    window.render = (active=true,preferences=defaults)=>window.root.render(<Profiler id="terminal" onRender={() => {
      window.commits++;
      if(window.armed) window.term._core._onWriteParsed.fire();
    }}><TerminalPane id="fixture" active={active} preferences={preferences} closed={false}
      suggestionsEnabled plugins={initialPlugins()} searching={false}
      onSearchClose={()=>{}} onError={e=>{throw e;}} /></Profiler>);window.render();window.defaults=defaults;
  `,
    loader: 'tsx',
    resolveDir: process.cwd(),
  },
  outfile: join(dir, 'app.js'),
  bundle: true,
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"' },
});
const server = createServer(async (req, res) => {
  const asset = req.url === '/app.js' ? 'app.js' : req.url === '/app.css' ? 'app.css' : null;
  res.setHeader(
    'Content-Type',
    asset === 'app.js' ? 'text/javascript' : asset ? 'text/css' : 'text/html',
  );
  res.end(
    asset
      ? await readFile(join(dir, asset))
      : '<link rel="stylesheet" href="/app.css"><style>html,body{margin:0;height:100%;overflow:hidden}#root{width:800px;height:500px}</style><div id="root"></div><script src="/app.js"></script>',
  );
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => {
    errors.push(e.message);
    if (errors.length < 3) console.error(e.stack);
  });
  await page.goto('http://127.0.0.1:' + (server.address() as { port: number }).port);
  await page.waitForFunction(() => !!(window as any).term);
  await page.waitForTimeout(400);
  const initial=await page.evaluate(()=>({rows:(window as any).term.rows,cols:(window as any).term.cols,host:document.querySelector('.terminal-host')!.getBoundingClientRect().toJSON()}));
  await page.evaluate(async()=>{const w=window as any;w.resizes=[];for(let i=0;i<300;i++){await new Promise<void>(r=>w.term.write('download '+i+'% '+ '='.repeat(i%70)+'\r',r));await new Promise(r=>setTimeout(r,4));}});
  assert.deepEqual(await page.evaluate(()=>(window as any).resizes), [], 'CR progress must not resize the PTY');
  await page.evaluate(async()=>{const t=(window as any).term;await new Promise<void>(r=>t.write(Array.from({length:1200},(_,i)=>'history-row-'+i+'\r\n').join(''),r));});
  await page.waitForTimeout(200);
  const before=await page.evaluate(()=>({base:(window as any).term.buffer.active.baseY,view:(window as any).term.buffer.active.viewportY,scrollbar:document.querySelector('.xterm .scrollbar.vertical')?.getBoundingClientRect().toJSON(),host:document.querySelector('.terminal-host')!.getBoundingClientRect().toJSON()}));
  await page.locator('.xterm-screen').hover();await page.mouse.wheel(0,-1200);await page.waitForTimeout(250);
  const scrolled = await page.evaluate(()=>(window as any).term.buffer.active.viewportY);
  assert.ok(scrolled < before.view, 'real wheel must reach history');
  await page.evaluate(async()=>{const t=(window as any).term;await new Promise<void>(r=>t.write('continued-output\r\n',r));});
  assert.equal(await page.evaluate(()=>(window as any).term.buffer.active.viewportY), scrolled, 'output must not pull readers to bottom');
  await page.waitForTimeout(1100);
  const bar = page.locator('.xterm-scrollable-element > .scrollbar.vertical');
  assert.equal(await bar.evaluate(el=>getComputedStyle(el).opacity), '1', 'history scrollbar remains visible after idle');
  const slider = await bar.locator('.slider').boundingBox();
  assert.ok(slider && slider.height > 0);
  await page.mouse.move(slider!.x+slider!.width/2,slider!.y+slider!.height/2);
  await page.mouse.down();await page.mouse.move(slider!.x+slider!.width/2,before.host.top+2,{steps:10});await page.mouse.up();
  assert.ok(await page.evaluate(()=>(window as any).term.buffer.active.viewportY) < scrolled, 'drag must reach older output');
  await page.locator('.terminal-history-return').click();
  assert.equal(await page.evaluate(()=>(window as any).term.buffer.active.viewportY),await page.evaluate(()=>(window as any).term.buffer.active.baseY));
  await page.evaluate(async()=>{const w=window as any;w.resizes=[];await new Promise<void>(r=>w.term.write('\x1b[?1049h\x1b[2J\x1b[H GNU nano 8.0  file.txt\x1b[24;1H^G Help  ^O Write Out  ^X Exit',r));for(let i=0;i<100;i++){await new Promise<void>(r=>w.term.write('\x1b[2;1Hline '+i+'\x1b[K',r));await new Promise(r=>setTimeout(r,5));}});
  assert.deepEqual(await page.evaluate(()=>(window as any).resizes), [], 'automatic nano detection must not resize the PTY');
  assert.deepEqual(await page.locator('.terminal-host').boundingBox(),{x:initial.host.x,y:initial.host.y,width:initial.host.width,height:initial.host.height});
  await page.getByRole('button',{name:/Nano /}).click();
  await page.waitForTimeout(200);
  assert.ok(await page.evaluate(()=>(window as any).resizes.length)>0, 'explicitly expanding tools may resize');
  await page.getByRole('button',{name:/Nano /}).click();
  for (const width of [360, 520, 800]) {
    await page.evaluate(width=>{document.getElementById('root')!.style.width=width+'px'},width);
    await page.waitForTimeout(180);
    await page.evaluate(async()=>{const w=window as any;w.resizes=[];for(let i=0;i<60;i++)await new Promise<void>(r=>w.term.write('\x1b[2;1Hchanging '+i+'\x1b[K',r));});
    await page.waitForTimeout(200);
    assert.deepEqual(await page.evaluate(()=>(window as any).resizes), [], 'redraw stable at '+width);
  }
  await page.evaluate(()=>{const w=window as any;w.resizes=[];w.render(false);});await page.waitForTimeout(100);
  await page.evaluate(()=>{const w=window as any;w.render(false,{...w.defaults,fontSize:18});});await page.waitForTimeout(150);
  assert.deepEqual(await page.evaluate(()=>(window as any).resizes), [], 'hidden tab must not resize PTY');
  console.log('PASS terminal stability: progress, nano, 360/520/800 widths, wheel, drag, output anchoring, hidden tab');
  assert.deepEqual(errors,[]);
} finally {
  await browser.close();
  server.close();
  await rm(dir, { recursive: true, force: true });
}
