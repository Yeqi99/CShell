import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const dir = await mkdtemp(join(tmpdir(), 'cshell-capabilities-ui-'));
await build({
  stdin: {
    contents: `
import React,{useState}from'react';import{createRoot}from'react-dom/client';import{AgentCapabilityMarket}from'./src/ui/components/AgentCapabilityMarket';
window.cshell={onDesktopViewEvent:()=>()=>{}};window.fixtureCalls=[];
const item={id:'cagent.desktop',name:'远程桌面',version:'1.0.0',description:'隔离测试桌面包',source:'bundled',permissions:['desktop.view','desktop.control'],installed:true,status:'authorization-required'};
let grants=[],config={enabled:false,bindAddress:'127.0.0.1',tcpPort:9998,udpPort:9999,local:{view:false,control:false},ownerGrants:{}};
async function call(method,params){window.fixtureCalls.push({method,params});if(method==='packages.catalog')return[item];if(method==='packages.list')return[{...item,requiredPermissions:item.permissions,grants,registered:grants.length>0}];if(method==='packages.grant'){grants=params.permissions;return{}}if(method==='desktop.status')return{enabled:config.enabled,listening:config.enabled,config,viewAllowed:false,controlAllowed:false};if(method==='desktop.configure'){config=params;return{}}throw Error('unexpected '+method);}
function Fixture(){const[local,setLocal]=useState(true);return <><button onClick={()=>setLocal(!local)}>切换目标</button><AgentCapabilityMarket key={String(local)} target={{id:local?'local':'remote',name:'fixture',local,available:true}} call={call}/></>};createRoot(document.getElementById('root')).render(<Fixture/>);`,
    resolveDir: process.cwd(),
    loader: 'tsx',
  },
  bundle: true,
  outfile: join(dir, 'fixture.js'),
  jsx: 'automatic',
});
const server = createServer(async (req, res) => {
  const file =
    req.url === '/fixture.js' ? 'fixture.js' : req.url === '/fixture.css' ? 'fixture.css' : '';
  res.setHeader(
    'Content-Type',
    file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html',
  );
  res.end(
    file
      ? await readFile(join(dir, file))
      : '<html><head><link rel="stylesheet" href="/fixture.css"><style>body{font:14px system-ui;max-width:700px;padding:20px;--border:#ddd;--muted:#667}button,input{font:inherit;padding:6px} .agent-toolbar{display:flex;gap:8px} .agent-app-grid button{display:grid;padding:12px}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>',
  );
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(10000);
  await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}`);
  await page.getByRole('button', { name: /远程桌面.*待授权/ }).click();
  await page.getByText('服务与访问权限', { exact: true }).click();
  assert.equal(await page.getByLabel('启用桌面服务', { exact: true }).isChecked(), false);
  assert.equal(
    await page.getByRole('button', { name: '连接桌面', exact: true }).isDisabled(),
    true,
  );
  await page.getByLabel('允许本机观看', { exact: true }).check();
  assert.equal(
    await page.evaluate(
      () =>
        (window as any).fixtureCalls.filter((c: any) => c.method === 'desktop.configure').length,
    ),
    0,
  );
  await page.getByRole('button', { name: '保存并应用服务配置', exact: true }).click();
  await page.waitForFunction(() =>
    (window as any).fixtureCalls.some((c: any) => c.method === 'desktop.configure'),
  );
  const call = await page.evaluate(() =>
    (window as any).fixtureCalls.find((c: any) => c.method === 'desktop.configure'),
  );
  assert.equal(call.params.enabled, false);
  assert.deepEqual(call.params.local, { view: true, control: false });
  await page.getByRole('button', { name: '切换目标', exact: true }).click();
  await page.getByRole('button', { name: /远程桌面.*待授权/ }).click();
  assert.equal(await page.getByRole('button', { name: '保存工具权限', exact: true }).count(), 0);
  assert.equal(await page.getByText('服务与访问权限', { exact: true }).count(), 0);
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/agent-capability-remote-ui.png' });
  await writeFile(
    'test-results/agent-capability-ui.json',
    JSON.stringify(
      {
        passed: true,
        isolated: true,
        checks: [
          'installed-required-grants',
          'service-default-off',
          'view-control-independent',
          'draft-before-save',
          'remote-no-mutation-controls',
          'viewer-disabled-without-view-grant',
        ],
      },
      null,
      2,
    ),
  );
  console.log('PASS: capability market and desktop configuration scope');
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  await rm(dir, { recursive: true, force: true });
}
