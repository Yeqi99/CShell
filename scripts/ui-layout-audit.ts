import { build } from 'esbuild';
import { chromium } from 'playwright';
import { mkdtemp, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const dir = await mkdtemp(join(tmpdir(), 'cshell-ui-audit-'));
await mkdir('test-results/ui-audit', { recursive: true });
await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: 'tsx',
    contents: `
import React from 'react';import{createRoot}from'react-dom/client';
import{AgentApplications}from'./src/ui/components/AgentApplications';import{CodingApp}from'./src/ui/components/CodingApp';import{IdeApp}from'./src/ui/components/IdeApp';import{MachineBrowser}from'./src/ui/components/MachineBrowser';import{MachineConnectionState}from'./src/ui/components/MachineConnectionState';import{LinuxDesktop}from'./src/ui/components/LinuxDesktop';import './src/ui/styles.css';
const call=async m=>{if(m==='coding.status')return{supported:true,directory:'/data/cagent/apps',engines:[{engine:'codex',ready:true,version:'1.0'}],profiles:[],installs:[]};if(m==='coding.tasks')return[];if(m==='ide.start')return{url:'http://127.0.0.1:8080/'};if(m==='ide.status')return{launchVersion:1,supported:true,ready:true,directory:'/data/editor',version:'code-server 4.0'};if(m==='applications.list')return{platform:'linux',manager:'apt',enabled:true,applications:[{id:'git',package:'git'},{id:'python',package:'python3'},{id:'curl',package:'curl'}]};if(m==='applications.policy')return{enabled:true,controllers:['*']};if(m.startsWith('packages.'))return[];return{};};
window.cshell={onMachineBrowserFocus:()=>()=>{},machineBrowser:async()=>({tabs:[{id:'one',title:'新标签页',url:'about:blank',zoom:1}],selected:'one',connected:true,history:[],bookmarks:[]}),events:()=>()=>{}};
const params=new URLSearchParams(location.search),view=params.get('view');let app;
if(view==='market')app=<AgentApplications target={{id:'ssh:fixture',name:'美国机器'}} call={call}/>;
if(view==='coding')app=<CodingApp engine="codex" name="美国机器 · 开发环境" active call={call} openBrowser={async()=>{}}/>;
if(view==='editor')app=<IdeApp call={call} target="ssh:fixture" active/>;
if(view==='browser')app=<MachineBrowser target="ssh:fixture" name="美国机器" active/>;
if(view==='connection')app=<MachineConnectionState name="美国机器" phase="error" error="连接超时，请重试" primary={{label:'重新连接',run:()=>{}}} secondary={{label:'SSH 终端',run:()=>{}}}/>;
if(view==='desktop')app=<LinuxDesktop name="美国机器" target="ssh:fixture" machine={{platform:'linux',deviceId:'fixture'}} call={call} active/>;
createRoot(document.getElementById('root')).render(app);`,
  },
  bundle: true,
  jsx: 'automatic',
  outfile: join(dir, 'fixture.js'),
});
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  for (const theme of ['light', 'dark'])
    for (const width of [1100, 540, 393])
      for (const view of ['market', 'coding', 'editor', 'browser', 'connection', 'desktop']) {
        const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }),
          errors: string[] = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await page.route('**/*', (r) =>
          r.fulfill({
            contentType: 'text/html',
            body:
              '<!doctype html><html data-theme="' +
              theme +
              '"><body><div id="root" class="desktop-window-content" style="width:' +
              width +
              'px;height:620px;margin:24px auto"></div></body></html>',
          }),
        );
        await page.goto('https://fixture.invalid/?view=' + view);
        await page.addStyleTag({ content: await readFile(join(dir, 'fixture.css'), 'utf8') });
        await page.addScriptTag({ content: await readFile(join(dir, 'fixture.js'), 'utf8') });
        if (view === 'coding') {
          await page.getByText('连接 Codex', { exact: true }).waitFor();
          if (width < 620)
            assert.ok(await page.getByRole('button', { name: '会话与设置' }).isVisible());
        }
        if (view === 'market') await page.getByText('开发工具', { exact: true }).waitFor();
        if (view === 'desktop') {
          if (theme === 'dark')
            await page.getByRole('button', { name: '切换桌面明暗主题' }).click();
          await page.getByRole('button', { name: '设置', exact: true }).dblclick();
          await page.locator('.desktop-settings').waitFor();
        }
        const overflow = await page
          .locator('#root')
          .evaluate((el) => ({ scroll: el.scrollWidth, width: el.clientWidth }));
        assert.ok(
          overflow.scroll <= overflow.width + 1,
          JSON.stringify({ view, width, theme, overflow }),
        );
        assert.deepEqual(errors, [], view);
        await page.screenshot({
          path: 'test-results/ui-audit/' + view + '-' + theme + '-' + width + '.png',
        });
        await page.close();
      }
  console.log(
    'PASS six workspace views at three container widths, light/dark themes; no horizontal overflow or page errors',
  );
} finally {
  await browser.close();
}
