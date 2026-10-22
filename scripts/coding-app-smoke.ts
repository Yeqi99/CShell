import { build } from 'esbuild';
import { chromium } from 'playwright';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const dir = await mkdtemp(join(tmpdir(), 'coding-layout-'));
await build({
  stdin: {
    contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {CodingApp} from './src/ui/components/CodingApp';import './src/ui/styles.css';
window.calls=[];window.failed=true;
const call=async(method)=>{window.calls.push(method);if(method==='coding.status'){if(window.failed)throw Error('CAgent 请求失败');if(window.transient){window.transient=false;throw Error('Client disconnected')}return {directory:'/data/coding',engines:[{engine:'codex',ready:false,path:''}],profiles:[],installs:[]}}if(method==='coding.tasks')return [];};
createRoot(document.getElementById('app')).render(<CodingApp engine="codex" name="WIN-3K4794IML24" call={call} openBrowser={async()=>{}} active={true}/>);`,
    resolveDir: process.cwd(),
    loader: 'tsx',
  },
  bundle: true,
  jsx: 'automatic',
  outfile: join(dir, 'fixture.js'),
});
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', (r) => r.abort());
  await page.route('https://fixture.invalid/', (r) =>
    r.fulfill({ contentType: 'text/html', body: '<div id="app" style="height:100vh"></div>' }),
  );
  await page.goto('https://fixture.invalid/');
  await page.addStyleTag({ content: await readFile(join(dir, 'fixture.css'), 'utf8') });
  await page.addScriptTag({ content: await readFile(join(dir, 'fixture.js'), 'utf8') });
  await page.getByRole('alert').waitFor();
  assert.equal(await page.getByText('需要安装客户端').count(), 0);
  assert.equal(await page.getByRole('button', { name: '客户端安装', exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => (window as any).calls.includes('coding.tasks')), false);
  await page.evaluate(() => {
    (window as any).failed = false; (window as any).transient = true;
  });
  await page.getByRole('button', { name: '刷新状态' }).click();
  await page.getByText('未配置客户端', { exact: true }).waitFor();
  assert.equal(await page.getByRole('alert').count(), 0);
  assert.equal(await page.getByRole('button', { name: /安装/ }).count(), 0);
  for (const size of [
    { width: 876, height: 464 },
    { width: 1100, height: 620 },
    { width: 640, height: 440 },
    { width: 393, height: 650 },
  ]) {
    await page.setViewportSize(size);
    const bounds = await page.evaluate(`(()=>{
      const box=(s)=>{const r=document.querySelector(s).getBoundingClientRect();return {top:r.top,bottom:r.bottom,right:r.right}};
      return {icon:box('.coding-empty > div'),area:box('.coding-conversation'),compose:box('.coding-compose'),scroll:document.querySelector('.coding-conversation').scrollTop,width:document.documentElement.scrollWidth};
    })()`);
    assert.ok(bounds.icon.top >= bounds.area.top, JSON.stringify(bounds));
    assert.ok(bounds.compose.bottom <= size.height);
    assert.equal(bounds.scroll, 0);
    assert.ok(bounds.width <= size.width);
    await page.screenshot({ path: 'test-results/coding-layout-' + size.width + '.png' });
  }
  assert.deepEqual(errors, []);
  console.log(
    'PASS unavailable → retry → unconfigured; single install entry; desktop, small window and mobile layout',
  );
} finally {
  await browser.close();
}
