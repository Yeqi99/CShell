import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

// Isolated component fixture; no Electron, user data, WeChat or model calls.
const dir = await mkdtemp(join(tmpdir(), 'cshell-events-ui-'));
await build({
  stdin: {
    contents: `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{AiEventSubscriptions}from'./src/ui/components/AiEventSubscriptions';
function Fixture(){const[rules,setRules]=useState([]);const[hidden,setHidden]=useState(false);const[fail,setFail]=useState(false);const[available,setAvailable]=useState(true);return <><button onClick={()=>setHidden(!hidden)}>切换页面</button><button onClick={()=>setFail(!fail)}>切换保存故障</button><button onClick={()=>setAvailable(!available)}>切换来源</button><div hidden={hidden}><AiEventSubscriptions rules={rules} sources={available?[{id:'wechat',name:'微信',available:true,eventTypes:[{id:'message',name:'收到消息'}]}]:[]} runs={[]} threads={[{id:'11111111-1111-4111-8111-111111111111',title:'测试会话',providerId:'p'}]} onSave={async r=>{if(fail)throw Error('保存失败：测试故障');setRules(old=>[...old.filter(x=>x.id!==r.id),r]);return r}} onRemove={async id=>setRules(old=>old.filter(r=>r.id!==id))} onRefresh={async()=>{}} onOpenThread={()=>{}}/></div></>};createRoot(document.getElementById('root')).render(<Fixture/>);`,
    resolveDir: process.cwd(),
    loader: 'tsx',
  },
  bundle: true,
  outfile: join(dir, 'fixture.js'),
  jsx: 'automatic',
});
const server = createServer(async (req, res) => {
  const name =
    req.url === '/fixture.js' ? 'fixture.js' : req.url === '/fixture.css' ? 'fixture.css' : '';
  res.setHeader(
    'Content-Type',
    name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html',
  );
  res.end(
    name
      ? await readFile(join(dir, name))
      : '<html><head><link rel="stylesheet" href="/fixture.css"><style>body{font:14px system-ui;max-width:520px;--border:#ddd;--muted:#657;--accent:#1677ff}button,input,select,textarea{font:inherit;padding:7px} .ai-section-heading{display:flex;justify-content:space-between} [hidden]{display:none!important}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>',
  );
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
console.log('Fixture browser ready');
try {
  const page = await browser.newPage({ viewport: { width: 520, height: 880 } });
  page.setDefaultTimeout(10000);
  page.on('pageerror', (error) => console.error(error.message));
  await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}`);
  await page.getByRole('button', { name: '新建事件订阅', exact: true }).click();
  assert.equal(await page.getByLabel('启用此订阅（保存后生效）').isChecked(), false);
  await page.getByText('频率与预算', { exact: true }).click();
  assert.equal(await page.getByLabel('每次预留 token', { exact: true }).inputValue(), '32768');
  assert.equal(await page.getByLabel('每日预留 token 上限', { exact: true }).inputValue(), '131072');
  assert.equal(await page.getByLabel('每次预留 token', { exact: true }).getAttribute('min'), '1024');
  assert.equal(await page.getByLabel('每次预留 token', { exact: true }).getAttribute('max'), '128000');
  await page.getByLabel('名称', { exact: true }).fill('私聊助手');
  await page.getByLabel('提示词', { exact: true }).fill('只回答当前消息，未知内容不猜测。');
  await page.getByRole('button', { name: '切换页面', exact: true }).click();
  await page.getByRole('button', { name: '切换页面', exact: true }).click();
  assert.equal(await page.getByLabel('名称', { exact: true }).inputValue(), '私聊助手');
  await page.getByRole('button', { name: '返回列表', exact: true }).click();
  await page.getByRole('button', { name: /私聊助手.*未保存草稿/ }).click();
  assert.match(await page.getByLabel('提示词', { exact: true }).inputValue(), /未知内容/);
  await page.getByRole('button', { name: '切换保存故障', exact: true }).click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '测试故障' }).waitFor();
  assert.equal(await page.getByLabel('名称', { exact: true }).inputValue(), '私聊助手');
  await page.getByRole('button', { name: '切换保存故障', exact: true }).click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor();
  await page.getByLabel('启用此订阅（保存后生效）').check();
  await page.getByRole('button', { name: '返回列表', exact: true }).click();
  await page.getByRole('button', { name: /私聊助手.*已停用/ }).waitFor();
  await page.getByRole('button', { name: '切换来源', exact: true }).click();
  assert.equal(
    await page.getByRole('button', { name: '新建事件订阅', exact: true }).isDisabled(),
    true,
  );
  await page.getByRole('button', { name: /私聊助手.*已停用/ }).click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '事件源当前不可用' }).waitFor();
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/ai-events-ui.png', fullPage: true });
  await writeFile(
    'test-results/ai-events-ui.json',
    JSON.stringify(
      {
        passed: true,
        checks: [
          'new-disabled',
          'draft-preserved-across-page-and-rule-switch',
          'save-error-retains-draft',
          'enabled-only-after-save',
          'unavailable-source-not-offered',
          'unavailable-source-cannot-enable',
        ],
        isolated: true,
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS: event subscription drafts, save errors, explicit activation, unavailable sources',
  );
} catch (error) {
  console.error(error);
  throw error;
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  await rm(dir, { recursive: true, force: true });
}
