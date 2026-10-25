import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { EventEmitter } from 'node:events';
import { BrowserLibrary, browserUrl } from '../src/core/browser-library';
const directory = mkdtempSync(join(tmpdir(), 'cshell-browser-state-'));
const codec = {
  encrypt: (s: string) => Buffer.from(s).reverse(),
  decrypt: (b: Buffer) => Buffer.from(b).reverse().toString(),
};
test('browser library restores tabs, selected tab, history and bookmarks and rejects executable URLs', () => {
  const path = join(directory, 'library.bin');
  const library = new BrowserLibrary(path, codec);
  library.data.tabs = [
    { url: 'https://example.com/a', title: 'A', zoom: 0.9 },
    { url: 'https://example.org/b', title: 'B', zoom: 1 },
  ];
  library.data.selected = 1;
  library.visit('https://example.com/a', 'A');
  library.bookmark('https://example.org/b', 'B');
  const restored = new BrowserLibrary(path, codec);
  assert.deepEqual(restored.data, library.data);
  assert.equal(readFileSync(path).includes('https://'), false);
  assert.equal(browserUrl('javascript:alert(1)'), false);
  assert.equal(browserUrl('https://user:pass@example.org'), false);
  restored.bookmark('https://example.org/b', 'B');
  assert.equal(new BrowserLibrary(path, codec).data.bookmarks.length, 0);
});
test('browser handles self-closing WebContents and restores after disconnect and window shutdown', async () => {
  const file = join(directory, 'browser.mjs');
  await build({
    entryPoints: ['src/desktop/machine-browser.ts'],
    outfile: file,
    bundle: true,
    platform: 'node',
    format: 'esm',
    plugins: [
      {
        name: 'electron-fixture',
        setup(b) {
          b.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'fixture' }));
          b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
            contents: `
   import {EventEmitter} from 'node:events';
   export class BrowserWindow {}
   export const app={getPath:()=>${JSON.stringify(directory)}};
   export const safeStorage={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s).reverse(),decryptString:b=>Buffer.from(b).reverse().toString()};
   class Contents extends EventEmitter {url='about:blank';zoom=1;dead=false;navigationHistory={canGoBack:()=>false,canGoForward:()=>false};isFocused(){return true}isDestroyed(){return this.dead}getURL(){return this.url}getTitle(){if(this.dead)throw Error('destroyed');return this.url}getZoomFactor(){return this.zoom}setZoomFactor(z){this.zoom=z}isLoading(){return false}setWebRTCIPHandlingPolicy(){}setWindowOpenHandler(handler){this.popupHandler=handler}async loadURL(url){this.url=url;this.emit('did-navigate');this.emit('page-title-updated')}close(){this.dead=true;this.emit('destroyed')} }
   export class WebContentsView {constructor(options){this.options=options;this.webContents=options.webContents||new Contents()}setVisible(){}setBounds(){} }
   const ses=new EventEmitter();Object.assign(ses,{clearAuthCache:async()=>{},clearStorageData:async()=>{},clearCache:async()=>{},setProxy:async()=>{},closeAllConnections:async()=>{},setPermissionRequestHandler(fn){this.request=fn},setPermissionCheckHandler(fn){this.check=fn},webRequest:{onBeforeRequest(){}},flushStorageData(){},cookies:{flushStore:async()=>{}}});
   export const session={fromPartition:()=>ses};`,
          }));
          b.onResolve({ filter: /ssh-browser-proxy$/ }, () => ({
            path: 'proxy',
            namespace: 'proxy',
          }));
          b.onLoad({ filter: /.*/, namespace: 'proxy' }, () => ({
            contents: 'export async function createSshBrowserProxy(){return{port:1080,close(){}}}',
          }));
        },
      },
    ],
  });
  const { MachineBrowser } = await import(pathToFileURL(file).href);
  const first = '11111111-1111-4111-8111-111111111111',
    second = '22222222-2222-4222-8222-222222222222';
  const clients = new Map(
    [first, second].map((id) => [
      id,
      {
        client: new EventEmitter(),
        closed: false,
        profile: { id: 'saved-machine', host: 'example.com', port: 22, username: 'user' },
      },
    ]),
  );
  const makeWindow = () =>
    Object.assign(new EventEmitter(), {
      isDestroyed: () => false,
      isFocused: () => true,
      getContentSize: () => [1200, 800],
      contentView: { addChildView() {}, removeChildView() {} },
      webContents: { focus() {}, send() {} },
    });
  const window = makeWindow();
  const browser = new MachineBrowser(window, { get: (id: string) => clients.get(id) });
  await browser.action(first, 'open');
  await browser.action(first, 'navigate', 'https://example.org/one');
  const firstWorkspace = await browser.workspaces.get(first);
  const firstContents = firstWorkspace.tabs.get(firstWorkspace.selected).view.webContents;
  for (const permission of ['fullscreen', 'clipboard-sanitized-write'])
    assert.equal(firstWorkspace.ses.check(firstContents, permission), true);
  assert.equal(firstWorkspace.ses.check(firstContents, 'clipboard-read'), false);
  firstContents.emit('enter-html-full-screen');
  assert.equal((await browser.action(first, 'status')).tabs[0].fullscreen, true);
  firstContents.emit('leave-html-full-screen');
  assert.equal((await browser.action(first, 'status')).tabs[0].fullscreen, false);
  let state = await browser.action(first, 'new');
  assert.equal(
    firstWorkspace.ses.check(firstContents, 'clipboard-sanitized-write'),
    false,
    'background pages cannot write clipboard',
  );
  await browser.action(first, 'navigate', 'https://example.org/two');
  const workspace = await browser.workspaces.get(first);
  const closedTab = workspace.tabs.get(state.selected);
  closedTab.view.webContents.close();
  closedTab.view.webContents = undefined;
  state = await browser.action(first, 'status');
  assert.equal(state.tabs.length, 1);
  assert.equal(state.tabs[0].url, 'https://example.org/one');
  // Also cover a stale wrapper whose destroyed event was never delivered.
  await browser.action(first, 'new');
  const stale = workspace.tabs.get(workspace.selected);
  stale.view.webContents = undefined;
  state = await browser.action(first, 'status');
  assert.equal(state.tabs.length, 1);

  // Mock-only popup regression: no Chromium or network requests are used.
  state = await browser.action(first, 'new');
  const parentId = state.selected,
    parent = workspace.tabs.get(parentId).view.webContents;
  const handler = parent.popupHandler({ url: 'https://login.example.test/authorize' });
  assert.equal(handler.action, 'allow');
  const supplied = new parent.constructor();
  const popup = handler.createWindow({
    webContents: supplied,
    webPreferences: { openerId: 42, nodeIntegration: true, sandbox: false, preload: 'unsafe.js' },
  });
  assert.equal(popup, supplied, 'must return the exact Electron-created popup webContents');
  assert.equal(handler.overrideBrowserWindowOptions.webPreferences.sandbox, true);
  assert.equal(handler.overrideBrowserWindowOptions.webPreferences.nodeIntegration, false);
  const popupId = workspace.selected,
    popupTab = workspace.tabs.get(popupId);
  assert.equal(popupTab.openerId, parentId);
  assert.equal(popupTab.view.options.webPreferences.openerId, 42);
  assert.equal(popupTab.view.options.webPreferences.nodeIntegration, false);
  assert.equal(popupTab.view.options.webPreferences.sandbox, true);
  assert.equal(popupTab.view.options.webPreferences.preload, undefined);
  assert.equal(
    popup.getURL(),
    'about:blank',
    'host must leave navigation and POST payload to Chromium',
  );
  popup.close();
  state = await browser.action(first, 'status');
  assert.equal(state.selected, parentId, 'return to opener, not first tab');
  const blank = parent.popupHandler({ url: 'about:blank' });
  assert.equal(blank.action, 'allow');
  blank.createWindow({});
  await browser.action(first, 'select', state.tabs[0].id);
  const selected = workspace.selected;
  workspace.tabs.get([...workspace.tabs.keys()].at(-1)).view.webContents.close();
  assert.equal(workspace.selected, selected, 'background popup must not steal selection');
  for (const url of ['file:///tmp/a', 'javascript:alert(1)', 'https://user:pass@example.test'])
    assert.equal(parent.popupHandler({ url }).action, 'deny');
  const manual = parent.popupHandler({ url: 'about:blank' });
  manual.createWindow({});
  await browser.action(first, 'close', workspace.selected);
  assert.equal(workspace.selected, parentId);
  for (let n = workspace.tabs.size; n < 12; n++) await browser.action(first, 'new');
  assert.equal(parent.popupHandler({ url: 'about:blank' }).action, 'deny');
  for (const id of [...workspace.tabs.keys()].slice(1)) await browser.action(first, 'close', id);
  workspace.connected = false;
  assert.equal(parent.popupHandler({ url: 'about:blank' }).action, 'deny');
  workspace.connected = true;
  await browser.action(first, 'bookmark', { url: 'https://example.org/one', title: 'One' });
  clients.get(first)!.client.emit('close');
  state = await browser.action(second, 'open');
  assert.equal(state.tabs[0].url, 'https://example.org/one');
  assert.equal(state.bookmarks.length, 1);
  window.emit('close');
  const w2 = await browser.workspaces.get(second);
  for (const tab of w2.tabs.values()) {
    tab.view.webContents.close();
    tab.view.webContents = undefined;
  }
  window.emit('closed');
  await new Promise((r) => setTimeout(r, 0));
  await browser.flush();
  const reopened = new MachineBrowser(makeWindow(), { get: () => clients.get(second) });
  state = await reopened.action(second, 'open');
  assert.equal(state.tabs[0].url, 'https://example.org/one');
  assert.ok(state.history.some((e: any) => e.url === 'https://example.org/one'));
  await reopened.action(second, 'remove-history', 'https://example.org/one');
  assert.ok(
    !(await reopened.action(second, 'status')).history.some(
      (e: any) => e.url === 'https://example.org/one',
    ),
  );
  await reopened.action(second, 'clear-history');
  assert.equal((await reopened.action(second, 'status')).history.length, 0);
  await assert.rejects(reopened.action(second, 'clear-logins', {}));
  state = await reopened.action(second, 'clear-logins', { confirm: true });
  assert.equal(state.tabs.length, 1);
  assert.equal(state.tabs[0].url, 'about:blank');
  assert.equal(state.bookmarks.length, 1);
});
