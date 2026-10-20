import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

// Real TerminalPane and xterm. Re-enter the parsed event during React's commit
// to exercise the synchronous parser/UI feedback observed under API echo load.
const dir = await mkdtemp(join(tmpdir(), 'terminal-parsed-race-'));
await build({
  stdin: {
    contents: `
    import React, { Profiler } from 'react';
    import { createRoot } from 'react-dom/client';
    import { Terminal } from '@xterm/xterm';
    import { TerminalPane } from './src/ui/components/TerminalPane';
    import { defaults } from './src/shared/contracts';
    import { initialPlugins } from './src/shared/plugins';
    const open = Terminal.prototype.open;
    Terminal.prototype.open = function(...args) { window.term = this; return open.apply(this,args); };
    window.cshell = new Proxy({
      onAiProvidersChanged: () => () => {},
      aiSnapshot: async () => ({providers: [], extractionProviderId:null}),
    }, {get:(target,key)=>target[key] || (async()=>{})});
    window.commits = 0;
    window.armed = false;
    window.root = createRoot(document.getElementById('root'));
    window.root.render(<Profiler id="terminal" onRender={() => {
      window.commits++;
      if(window.armed) window.term._core._onWriteParsed.fire();
    }}><TerminalPane id="fixture" active preferences={defaults} closed={false}
      suggestionsEnabled plugins={initialPlugins()} searching={false}
      onSearchClose={()=>{}} onError={e=>{throw e;}} /></Profiler>);
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
      : '<link rel="stylesheet" href="/app.css"><style>.terminal-pane{position:relative;width:800px;height:500px}.terminal-host{width:800px;height:450px}</style><div id="root"></div><script src="/app.js"></script>',
  );
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => {
    errors.push(e.message);
    console.error(e.stack);
  });
  await page.goto('http://127.0.0.1:' + (server.address() as { port: number }).port);
  await page.waitForFunction(() => !!(window as any).term);
  await page.evaluate(async () => {
    await new Promise<void>((r) => (window as any).term.write('test$ ', r));
  });
  await page.locator('.xterm-helper-textarea').focus();
  await page.keyboard.type('c');
  await page.evaluate(async () => {
    const w = window as any;
    w.armed = true;
    await new Promise<void>((r) => w.term.write('c', r));
    for (let i = 0; i < 200; i++) w.term._core._onWriteParsed.fire();
  });
  await page.waitForTimeout(350);
  assert.deepEqual(errors, [], 'Commit-time parser callbacks must not recursively update React');
  assert.ok(
    await page.getByRole('listbox', { name: 'Linux commands' }).isVisible(),
    'Parsed prompt must still present command suggestions',
  );
  const settled = await page.evaluate(() => (window as any).commits);
  await page.waitForTimeout(200);
  assert.equal(
    await page.evaluate(() => (window as any).commits),
    settled,
    'Unchanged cursor and input must settle',
  );
  assert.ok(settled < 20, `Expected bounded commits, got ${settled}`);
  await page.evaluate(() => {
    const w = window as any;
    w.term._core._onWriteParsed.fire();
    w.root.unmount();
  });
  await page.waitForTimeout(100);
  assert.deepEqual(errors, [], 'Pending presentation callbacks must be cancelled on unmount');
  console.log(
    'PASS real xterm burst/commit re-entry, suggestions retained, stable cursor settles, pending frame unmount',
    { commits: settled },
  );
} finally {
  await browser.close();
  server.close();
  await rm(dir, { recursive: true, force: true });
}
