import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

// The real Settings component must reconcile a layout update and a form edit
// in the same event without echoing stale previews back through its parent.
const dir = await mkdtemp(join(tmpdir(), 'settings-layout-race-'));
await build({
  stdin: {
    contents: `
      import React, { useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { Settings } from './src/ui/components/Settings';
      import { defaults } from './src/shared/contracts';
      // Ancillary settings services are not involved in this rendering race.
      window.cshell = new Proxy({
        systemFonts: async () => [],
        presets: async () => [{
          id: 'preset-layout', name: '自定义布局',
          preferences: { ...defaults, layout: { ...defaults.layout, serverWidth: 310 } },
        }],
      }, {
        get: (target, key) => target[key] || (() => new Promise(() => {})),
      });
      window.renders = 0;
      function Fixture() {
        const [preview, setPreview] = useState(defaults);
        const [request, setRequest] = useState(null);
        window.renders++;
        window.change = () => {
          setPreview(p => ({ ...p, layout: { ...p.layout, serverWidth: p.layout.serverWidth + 1 } }));
          setRequest({ theme: 'dark' });
        };
        window.result = preview;
        return <Settings value={defaults} layout={preview.layout} themeRequest={request}
          onPreview={setPreview} onSave={async () => {}} onClose={() => {}} />;
      }
      createRoot(document.getElementById('root')).render(<Fixture />);
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
  res.setHeader('Content-Type', req.url === '/app.js' ? 'text/javascript' : 'text/html');
  res.end(
    req.url === '/app.js'
      ? await readFile(join(dir, 'app.js'))
      : '<div id="root"></div><script src="/app.js"></script>',
  );
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => {
    errors.push(error.message);
    console.error(error.stack);
  });
  await page.goto('http://127.0.0.1:' + (server.address() as { port: number }).port);
  await page.waitForFunction(() => !!(window as any).change);
  const initial = await page.evaluate(() => (window as any).result.layout.serverWidth);
  await page.evaluate(() => {
    document.addEventListener('change', () => (window as any).change(), {
      capture: true,
      once: true,
    });
  });
  await page
    .locator('select')
    .filter({ has: page.locator('option[value=dark]') })
    .selectOption('dark');
  await page.waitForTimeout(200);
  const result = await page.evaluate(() => ({
    renders: (window as any).renders,
    width: (window as any).result.layout.serverWidth,
    theme: (window as any).result.theme,
  }));
  assert.deepEqual(errors, [], 'A simultaneous form edit and layout update must not crash React');
  assert.equal(result.width, initial + 1, 'The external layout change must be retained');
  assert.equal(result.theme, 'dark', 'The local theme draft must also be retained');
  assert.ok(result.renders < 20, `Preview updates must settle, got ${result.renders} renders`);
  await page.getByRole('button', { name: '工作区', exact: true }).click();
  await page.locator('.preset-row select').selectOption('preset-layout');
  await page.waitForFunction(() => (window as any).result.layout.serverWidth === 310);
  const settled = await page.evaluate(() => (window as any).renders);
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => (window as any).renders), settled);
  assert.deepEqual(errors, [], 'A saved layout must preview without being overwritten or looping');
  console.log(
    'PASS simultaneous layout/theme changes converge; saved preset layouts preview and settle',
    result,
  );
} finally {
  await browser.close();
  server.close();
  await rm(dir, { recursive: true, force: true });
}
