import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Real components at a constrained workspace width beside an independent agent pane.
// All bridge calls use isolated data; no user connections, clipboard, installs or network.
const directory = await mkdtemp(join(tmpdir(), 'cshell-category-workspace-'));
await build({
  stdin: { contents: `
    import React, {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import './src/ui/styles.css';
    import {Settings} from './src/ui/components/Settings';
    import {ExtensionWorkbench} from './src/ui/components/ExtensionWorkbench';
    import {RdpCagentInstallGuide} from './src/ui/components/RdpMachineWorkspace';
    import {defaults} from './src/shared/contracts';
    import {toolsDefaults} from './src/shared/docker';
    window.actions=[];
    window.cshell = new Proxy({
      pluginSource:async()=>null, systemFonts:async()=>[], presets:async()=>[], jobs:async()=>[],
      environments:async()=>({environments:[],python:'',conda:'',platform:'linux',arch:'x64'}),
      localEnvironment:async()=>({overrides:[],inherited:[]}),
      updateState:async()=>({current:'0.8.9',phase:'current',platform:'win32'}),
      copyText:async text=>{window.actions.push({type:'copy',text});},
      clientDownloadPage:async platform=>{window.actions.push({type:'download',platform});},
      pluginProcessStatus:async()=>[{id:'example.process',status:'authorization-required',grants:[],requiredPermissions:['extension.execute'],registered:false,enabled:true}],
      pluginProcessAuthorize:async(id,allowed)=>{window.actions.push({type:'authorize',id,allowed});return [{id,status:allowed?'available':'authorization-required',grants:allowed?['extension.execute']:[],requiredPermissions:['extension.execute'],registered:allowed,enabled:true}];},
    },{get:(target,key)=>key in target?target[key]:String(key).startsWith('on')?()=>()=>{}:()=>new Promise(()=>{})});
    function Fixture(){
      const [mode,setMode]=useState('extensions'); window.setMode=setMode;
      const [plugins,setPlugins]=useState([]);window.setFixturePlugins=setPlugins;
      const onPreview=React.useCallback(value=>{window.settingsPreview=value;},[]);
      return <div style={{display:'flex',height:'100vh',gap:12,padding:12,boxSizing:'border-box'}}>
        <main id="test-workspace" style={{width:700,height:'100%',minWidth:0,flexShrink:0}}>
          <div hidden={mode!=='extensions'} style={{height:'100%'}}><ExtensionWorkbench tools={toolsDefaults} plugins={plugins} sessions={[{id:'fixture',label:'隔离测试机器',closed:false}]} visible={mode==='extensions'} onLocal={async()=>{}} onChange={async()=>{}} onTerminal={()=>{}} request={null}/></div>
          <div hidden={mode!=='settings'} style={{height:'100%'}}><Settings value={defaults} layout={defaults.layout} onSave={async value=>{window.saved=value;}} onClose={()=>{}} onPreview={onPreview}/></div>
          <div hidden={mode!=='rdp'} style={{height:'100%',overflow:'auto'}}><RdpCagentInstallGuide name="测试 Windows" address="192.0.2.10:3389" busy={false} onOpenDesktop={()=>window.actions.push({type:'rdp'})}/></div>
        </main>
        <aside aria-label="并存的智能体测试面板" style={{width:360,flexShrink:0,padding:20,background:'var(--panel)',borderLeft:'1px solid var(--border)'}}><h2>智能体</h2><textarea aria-label="智能体草稿" defaultValue="保留这段未发送的草稿" style={{width:'100%',height:140}}/></aside>
      </div>;
    }
    createRoot(document.getElementById('root')).render(<Fixture/>);
  `, loader: 'tsx', resolveDir: process.cwd() },
  outfile: join(directory, 'app.js'), bundle: true, jsx: 'automatic',
  loader: { '.woff2': 'dataurl', '.svg': 'dataurl' },
});
const server = createServer(async (request, response) => {
  const name = request.url === '/app.js' ? 'app.js' : request.url === '/app.css' ? 'app.css' : undefined;
  response.setHeader('Content-Type', name ? name.endsWith('.js') ? 'text/javascript' : 'text/css' : 'text/html; charset=utf-8');
  response.end(name ? await readFile(join(directory, name)) : '<html data-theme="light"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script></html>');
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
try {
  await mkdir('test-results/category-workspace', { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${(server.address() as {port:number}).port}`);
  await page.getByRole('textbox', { name: '搜索插件', exact: true }).fill('Python');
  const resize = async (width: number) => {
    await page.locator('#test-workspace').evaluate((element, value) => { (element as HTMLElement).style.width = value + 'px'; }, width);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  };
  for (const width of [320, 400, 700]) {
    await resize(width);
    for (const mode of ['extensions', 'settings']) {
      await page.evaluate(mode => (window as any).setMode(mode), mode);
      const nav = page.locator(mode === 'extensions' ? '.extension-nav' : '.settings-nav');
      await nav.waitFor({state:'visible'});
      assert.equal(await nav.evaluate(element => getComputedStyle(element).display), 'flex');
      assert(await nav.locator('button').evaluateAll(buttons => buttons.every(button => getComputedStyle(button).whiteSpace === 'nowrap' && button.clientHeight < 50)), 'Labels must stay on one line');
      const panel = page.locator(mode === 'extensions' ? '.extension-workbench' : '.categorized-settings');
      assert(await panel.evaluate(element => element.scrollWidth <= element.clientWidth + 1), `${mode} ${width}: workspace horizontal overflow`);
      if (mode === 'extensions') {
        await nav.getByRole('button', {name:'应用市场',exact:true}).click();
        await page.locator('.application-market:visible').waitFor();
        assert(await page.locator('.extension-main').evaluate(element => element.scrollWidth <= element.clientWidth + 1), `${width}: app content horizontal overflow`);
        await nav.getByRole('button', {name:'插件市场',exact:true}).click();
        assert.equal(await page.getByRole('textbox', {name:'搜索插件',exact:true}).inputValue(), 'Python');
      } else {
        await nav.getByRole('button', {name:'外观',exact:true}).click();
        await page.getByLabel('界面字号', {exact:true}).fill('17');
        await nav.getByRole('button', {name:'终端',exact:true}).click();
        await nav.getByRole('button', {name:'关于与更新',exact:true}).focus();
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
        const focused = await page.evaluate(() => {const button=document.activeElement!.getBoundingClientRect();const nav=document.querySelector('.settings-nav')!.getBoundingClientRect();return button.left>=nav.left && button.right<=nav.right+1;});
        assert(focused, 'Keyboard focus scrolls the category into view');
        await nav.getByRole('button', {name:'外观',exact:true}).click();
        assert.equal(await page.getByLabel('界面字号', {exact:true}).inputValue(), '17');
        assert(await page.locator('.settings-content').evaluate(element => element.scrollWidth <= element.clientWidth + 1), `${width}: settings content horizontal overflow`);
      }
      await page.locator('#test-workspace').screenshot({path:`test-results/category-workspace/${mode}-${width}.png`});
    }
    await page.evaluate(() => (window as any).setMode('rdp'));
    const guide = page.getByRole('region', {name:'Windows CAgent 安装指引'});
    await guide.waitFor();
    assert.equal(await guide.locator('select').count(), 0, 'RDP setup must not request an SSH profile');
    assert(!/SSH|一键安装/.test(await guide.innerText()));
    assert(await guide.evaluate(element => element.scrollWidth <= element.clientWidth + 1), `${width}: RDP guide horizontal overflow`);
    await guide.getByRole('button', {name:/复制下载地址|已复制下载地址/}).click();
    await guide.getByRole('button', {name:'本机打开下载页',exact:true}).click();
    await guide.getByRole('button', {name:'打开远程桌面',exact:true}).click();
    await page.locator('#test-workspace').screenshot({path:`test-results/category-workspace/rdp-${width}.png`});
    assert.equal(await page.getByRole('textbox', {name:'智能体草稿'}).inputValue(), '保留这段未发送的草稿');
  }
  await page.evaluate(() => {document.documentElement.dataset.theme='dark';(window as any).setMode('extensions');});
  await page.locator('#test-workspace').screenshot({path:'test-results/category-workspace/extensions-dark-700.png'});
  await resize(900);
  assert.equal(await page.locator('.extension-nav').evaluate(element => getComputedStyle(element).display), 'block', 'Wide panel restores vertical navigation without remounting');
  assert.equal(await page.getByRole('textbox', {name:'搜索插件',exact:true}).inputValue(), 'Python');
  await page.evaluate(() => (window as any).setFixturePlugins([{manifest:{protocol:1,id:'example.process',version:'1.0.0',name:'自定义工具示例',description:'输入输出经过验证的独立工具',publisher:'Example',provider:'process',permissions:['remote.execute'],commands:[]},enabled:true,source:'custom:fixture'}]));
  await page.getByRole('textbox', {name:'搜索插件',exact:true}).fill('');
  await page.locator('.extension-toolbar select').selectOption('custom');
  await resize(320);
  const grant=page.getByRole('button',{name:'授权运行',exact:true});await grant.waitFor();
  assert.equal((await page.evaluate(()=>(window as any).actions)).filter((action:any)=>action.type==='authorize').length,0,'Enabling must not authorize code');
  await grant.click();await page.getByRole('button',{name:'撤销运行权限',exact:true}).waitFor();
  await page.locator('#test-workspace').screenshot({path:'test-results/category-workspace/process-extension-320.png'});
  assert(await page.locator('.extension-main').evaluate(element=>element.scrollWidth<=element.clientWidth+1),'Process extension narrow card overflow');
  await page.getByRole('button',{name:'撤销运行权限',exact:true}).click();await grant.waitFor();
  assert.deepEqual(errors, []);
  const actions = await page.evaluate(() => (window as any).actions);
  assert.equal(actions.filter((action:any) => action.type==='rdp').length, 3);
  assert.equal(actions.filter((action:any) => action.type==='download').length, 3);
  assert(actions.filter((action:any)=>action.type==='download').every((action:any)=>action.platform==='windows'));
  assert.deepEqual(actions.filter((action:any)=>action.type==='authorize').map((action:any)=>action.allowed),[true,false]);
  assert(actions.filter((action:any) => action.type==='copy').every((action:any)=>action.text==='https://shell.canp.ai/downloads.html?product=cagent&system=windows'));
  console.log('PASS actual extension/settings/RDP guide components: 320/400/700 panel widths beside agent pane, draft retention, focus scrolling, no SSH picker, fixed download entry, no install execution');
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await rm(directory, {recursive:true,force:true});
}
