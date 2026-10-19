import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const dir = await mkdtemp(join(tmpdir(), 'tavily-ui-'));
await build({
  stdin: {
    contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {TavilyView} from './src/extensions/tavily/View';import './src/ui/styles.css';let state={accounts:[],allowPaygo:false};window.calls=[];window.cshell={aiExtensionCall:async(id,action,input)=>{window.calls.push({action,input});if(action==='save')state.accounts.push({id:'fixture-'+state.accounts.length,name:input.name,maskedKey:'••••1234',enabled:true,remaining:80,checkedAt:Date.now(),usage:{key:{usage:20,limit:100},account:{current_plan:'Researcher',plan_usage:20,plan_limit:100}}});if(action==='remove')state.accounts=state.accounts.filter(a=>a.id!==input.id);if(action==='settings')state.allowPaygo=input.allowPaygo;return structuredClone(state);}};createRoot(document.getElementById('root')).render(<TavilyView/>);`,
    resolveDir: process.cwd(),
    loader: 'tsx',
  },
  outfile: join(dir, 'app.js'),
  bundle: true,
  jsx: 'automatic',
  loader: { '.woff2': 'dataurl', '.svg': 'dataurl' },
});
const server = createServer(async (req, res) => {
  const f = req.url === '/app.js' ? 'app.js' : req.url === '/app.css' ? 'app.css' : undefined;
  res.setHeader(
    'Content-Type',
    f ? (f.endsWith('js') ? 'application/javascript' : 'text/css') : 'text/html; charset=utf-8',
  );
  res.end(
    f
      ? await readFile(join(dir, f))
      : '<link rel="stylesheet" href="app.css"><div id="root"></div><script src="app.js"></script>',
  );
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({
  channel: process.platform === 'win32' ? 'msedge' : undefined,
  headless: true,
});
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${(server.address() as any).port}`);
  await page.getByPlaceholder('tvly-…').fill('tvly-test-fixture');
  await page.getByRole('button', { name: '保存并检测' }).click();
  await page.getByText('Researcher', { exact: false }).waitFor();
  assert.equal(await page.getByPlaceholder('tvly-…').inputValue(), '');
  await page.getByPlaceholder('tvly-…').fill('tvly-test-fixture2');
  await page.getByRole('button', { name: '保存并检测' }).click();
  await page.getByRole('button', { name: '移除 Key 2', exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/tavily-extension-ui.png', fullPage: true });
  await page.setViewportSize({ width: 480, height: 900 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.getByRole('button', { name: '移除 Key 1', exact: true }).click();
  await page
    .getByRole('button', { name: '移除 Key 1', exact: true })
    .waitFor({ state: 'detached' });
  assert.deepEqual(errors, []);
  console.log('PASS Tavily multi-key add, masked state, remove, narrow layout');
} finally {
  await browser.close();
  server.close();
  await rm(dir, { recursive: true, force: true });
}
