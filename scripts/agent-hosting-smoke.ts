import { build } from 'esbuild';
import { _electron as electron } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { HostingService } from '../src/agent/hosting';
const dir = await mkdtemp(join(tmpdir(), 'hosting-ui-'));
const service = new HostingService(join(dir, 'data'));
await service.load();
await build({
  stdin: {
    contents: `import React from 'react';import{createRoot}from'react-dom/client';import{AgentHostingPanel}from'./src/ui/components/AgentHostingPanel';import './src/ui/styles.css';createRoot(document.getElementById('root')).render(<AgentHostingPanel target="本机 Agent" call={async(method,params)=>{const r=await fetch('/call',{method:'POST',body:JSON.stringify({method,params})});const x=await r.json();if(!r.ok)throw new Error(x.error);return x;}}/>);`,
    resolveDir: process.cwd(),
    loader: 'tsx',
  },
  bundle: true,
  outfile: join(dir, 'app.js'),
  format: 'esm',
  jsx: 'automatic',
});
const api = createServer(async (req, res) => {
  try {
    if (req.url === '/call') {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c);
      const { method, params } = JSON.parse(Buffer.concat(chunks).toString());
      let value;
      switch (method) {
        case 'hosting.list':
          value = service.list();
          break;
        case 'hosting.save':
          value = await service.save(params.config);
          break;
        case 'hosting.start':
          value = await service.start(params.id, {
            allowCode: params.allowCode,
            expectedRevision: params.expectedRevision,
          });
          break;
        case 'hosting.stop':
          value = await service.stop(params.id);
          break;
        case 'hosting.logs':
          value = service.logs(params.id);
          break;
        case 'hosting.remove':
          await service.remove(params.id);
          value = {};
      }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(value));
      return;
    }
    if (req.url === '/app.js' || req.url === '/app.css') {
      res.setHeader('content-type', req.url.endsWith('js') ? 'text/javascript' : 'text/css');
      res.end(await readFile(join(dir, req.url.slice(1))));
      return;
    }
    res.setHeader('content-type', 'text/html');
    res.end(
      '<!doctype html><html data-theme="light"><head><link rel="stylesheet" href="/app.css"></head><body data-theme="light"><div id="root" style="height:100vh"></div><script type="module" src="/app.js"></script></body></html>',
    );
  } catch (e) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: String((e as Error).message) }));
  }
});
await new Promise<void>((r) => api.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${(api.address() as any).port}`;
await writeFile(
  join(dir, 'main.cjs'),
  `const{app,BrowserWindow}=require('electron');app.whenReady().then(()=>{const w=new BrowserWindow({width:1100,height:820});w.loadURL(${JSON.stringify(url)});});`,
);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [join(dir, 'main.cjs')], env });
try {
  const p = await app.firstWindow();
  p.setDefaultTimeout(10000);
  await p.getByRole('button', { name: '新建 HTTP 服务', exact: true }).click();
  await p.getByLabel('名称', { exact: true }).fill('回调入口');
  await p.getByLabel('方法', { exact: true }).selectOption('POST');
  await p.getByLabel('处理方式', { exact: true }).selectOption('callback');
  await p.getByLabel('响应内容', { exact: true }).fill('ok');
  await p.getByRole('button', { name: '保存 HTTP 服务', exact: true }).click();
  await p.getByRole('status').filter({ hasText: '已保存' }).waitFor();
  await p.getByRole('button', { name: '启动 HTTP 服务', exact: true }).click();
  await p.getByRole('button', { name: '停止 HTTP 服务', exact: true }).waitFor();
  const s = service.list()[0];
  assert.equal(
    await (
      await fetch(`http://127.0.0.1:${s.actualPort}/`, { method: 'POST', body: 'real callback' })
    ).text(),
    'ok',
  );
  await p.getByRole('button', { name: '日志', exact: true }).click();
  await p.getByText(/POST \/ · 200/).click();
  await p.getByText('real callback', { exact: true }).waitFor();
  await p.getByRole('button', { name: '返回配置', exact: true }).click();
  await p.screenshot({ path: 'test-results/agent-hosting-light.png' });
  await p.evaluate(() => (document.documentElement.dataset.theme = 'dark'));
  await p.screenshot({ path: 'test-results/agent-hosting-dark.png' });
  await p.evaluate(() => (document.documentElement.dataset.theme = 'light'));
  await p.getByRole('button', { name: '停止 HTTP 服务', exact: true }).click();
  await p.getByRole('button', { name: '启动 HTTP 服务', exact: true }).waitFor();
  await p.getByLabel('响应内容', { exact: true }).fill('unsaved draft');
  await p.getByRole('button', { name: '新建 HTTP 服务', exact: true }).click();
  await p.getByRole('button', { name: /回调入口/ }).click();
  assert.equal(await p.getByLabel('响应内容', { exact: true }).inputValue(), 'unsaved draft');
  await p.getByLabel('处理方式', { exact: true }).selectOption('code');
  await p.getByLabel('JavaScript', { exact: true }).fill('return "from worker"');
  await p.getByRole('button', { name: '保存 HTTP 服务', exact: true }).click();
  await p.getByRole('status').filter({ hasText: '已保存' }).waitFor();
  assert.equal(
    await p.getByRole('button', { name: '启动 HTTP 服务', exact: true }).isDisabled(),
    true,
  );
  await p.getByRole('checkbox', { name: /我已审查/ }).check();
  await p.getByRole('button', { name: '启动 HTTP 服务', exact: true }).click();
  await p.getByRole('button', { name: '停止 HTTP 服务', exact: true }).waitFor();
  assert.equal(
    await (
      await fetch(`http://127.0.0.1:${service.list()[0].actualPort}/`, { method: 'POST' })
    ).text(),
    'from worker',
  );
  await p.getByRole('button', { name: '停止 HTTP 服务', exact: true }).click();
  await p.getByRole('button', { name: '启动 HTTP 服务', exact: true }).waitFor();
  await p.getByRole('button', { name: '删除 HTTP 服务', exact: true }).click();
  await p.getByRole('button', { name: '确认删除', exact: true }).click();
  await p.getByText('新建服务后，配置路由并手动启动。', { exact: true }).waitFor();
  assert.equal(service.list().length, 0);
  console.log('PASS real Electron hosting UI + native HTTP/worker + draft retention');
} finally {
  await app.close();
  await service.dispose();
  await new Promise<void>((r) => api.close(() => r()));
  await rm(dir, { recursive: true, force: true });
}
