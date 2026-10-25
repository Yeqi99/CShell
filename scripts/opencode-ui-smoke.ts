import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const dir = await mkdtemp(join(tmpdir(), 'opencode-ui-'));
await build({
  stdin: {
    contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {OpenCodeView} from './src/extensions/opencode/View';import './src/ui/styles.css';window.calls=[];window.cshell={onAiProvidersChanged:()=>()=>{},aiExtensionCall:async(id,action,input)=>{window.calls.push({action,input});if(action==='status')return {accounts:[{id:'default',name:'个人账号',workspace:'wrk_test'}]};if(action==='save')return {accounts:[{id:'default',name:'个人账号',workspace:'wrk_test'},{id:input.id,name:input.name,workspace:''}]};if(action==='check')return {authenticated:true,model:'glm-5.3',elapsedMs:12,models:[{id:'glm-5.3',available:true}],usage:{windows:[{label:'5 小时',usedPercent:23}],checkedAt:Date.now(),message:'官方 Go 套餐使用量；不是现金余额'}};if(action==='models')return [{id:'glm-5.3',available:true},{id:'kimi-k3',available:true},{id:'unknown',available:false}];if(action==='usage')return {windows:[{label:'5 小时',usedPercent:23}],checkedAt:Date.now(),message:'官方 Go 套餐使用量；不是现金余额'};return {id:'new'};}};createRoot(document.getElementById('root')).render(<OpenCodeView/>);`,
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
  const page = await browser.newPage({ viewport: { width: 1000, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => {
    errors.push(e.message);
    console.error(e.message);
  });
  await page.goto(`http://127.0.0.1:${(server.address() as any).port}`);
  await page.waitForTimeout(500);
  console.log(await page.locator('body').innerText());
  await page.screenshot({ path: 'test-results/opencode-debug-ui.png', fullPage: true });
  await page.getByRole('radio', { name: 'glm-5.3 目录已列出 · 调用权限待验证' }).click();
  await page.getByRole('button', { name: '接入此账号' }).click();
  await page.getByText('已接入账号，可在智能体中直接选择其模型').waitFor();
  await page.getByRole('button', { name: '刷新用量' }).click();
  await page.getByText('已用 23.0%').waitFor();
  await page.getByRole('button', { name: '添加密钥', exact: true }).click();
  await page.getByLabel('API Key', { exact: true }).fill('fixture-secret');
  await page.getByRole('button', { name: '保存并检测' }).click();
  await page.getByText('账号已接入', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '账号 2', exact: false }).count(), 1);
  await page.getByLabel('查找模型').fill('missing');
  await page.getByText('没有匹配的模型').waitFor();
  await page.getByLabel('查找模型').fill('');
  await page.screenshot({ path: 'test-results/opencode-extension-ui.png', fullPage: true });
  await page.setViewportSize({ width: 340, height: 900 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.evaluate(() => {document.documentElement.dataset.theme='light';});
  await page.screenshot({path:'test-results/opencode-extension-ui-light-narrow.png',fullPage:true});
  assert.deepEqual(errors, []);
  assert.equal(
    await page.evaluate(
      () => (window as any).calls.find((c: any) => c.action === 'connect').input.id,
    ),
    'default',
  );
  assert.equal(await page.evaluate(() => (window as any).calls.some((c:any)=>c.action==='check')),false);
  const boxes=await page.getByRole('radio').evaluateAll(els=>els.map(el=>({top:el.getBoundingClientRect().top,bottom:el.getBoundingClientRect().bottom})));
  for(let i=1;i<boxes.length;i++)assert.ok(boxes[i].top>=boxes[i-1].bottom,'model rows must not overlap');
  console.log('PASS OpenCode extension model selection, usage and narrow layout');
} finally {
  await browser.close();
  server.close();
  await rm(dir, { recursive: true, force: true });
}
