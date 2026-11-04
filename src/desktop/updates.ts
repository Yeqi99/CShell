import {applicationUpdateTool} from '../core/application-update-tool';
import {UpdateReceipt} from './update-receipt';
import { requestUpdateWithFallback } from '../shared/update-source-fallback';
import {agentDownloads,type AgentDownload} from '../shared/agent-downloads';
import { isPro } from '../shared/edition';
import { app, shell, net, type BrowserWindow } from 'electron';
import { mkdir, open, rename, rm, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import type { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { prepareAppImageUpdate, prepareMacUpdate } from './portable-update';
import {
  checksumFor,
  compareVersion,
  releaseApi,
  releasesPage,
  selectRelease,
  type UpdateRelease,
  type UpdateState,
} from '../shared/updates';

// Only the main process resolves release assets. Renderer cannot supply a URL or path.
export function registerUpdateHandlers(
  register: (name: string, fn: (...args: any[]) => any) => void,
  window: BrowserWindow,
) {
  const handlers=new Map<string,(...args:any[])=>any>();
  const handle=(name:string,fn:(...args:any[])=>any)=>{handlers.set(name,fn);register(name,fn);};
  const receipt=new UpdateReceipt(app.getPath('userData'),app.getVersion());
  const receiptReady=receipt.load();
  let operation: string|undefined;
  let installAuthorization:(()=>void)|undefined;
  let state: UpdateState = { current: app.getVersion(), phase: 'idle', platform: process.platform, automatic:true };
  let release: UpdateRelease | undefined,
    file = '',
    expected = '',
    busy = false, queued = false;
  const request = async (url: string, timeout = 30000) => {
    // Follow the OS proxy configuration, like the user's browser.
    const response = await requestUpdateWithFallback(url, candidate => net.fetch(candidate, {
      headers: {
        'User-Agent': 'CShell/' + app.getVersion(),
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(timeout),
      redirect: 'manual',
    }));
    if (!response.ok) throw new Error('香港更新服务 HTTP ' + response.status);
    return response;
  };
  const fail = (e: unknown, retry: 'check' | 'download') => {
    state = { ...state, phase: 'error', retry, error: e instanceof Error ? e.message : String(e) };
    return state;
  };
  let agentPackages:AgentDownload[]=[];
  handle('agent:download-list',async()=>{
    const channel=isPro?'pro':'opensource';const catalogs=[await(await request('https://shell.canp.ai/downloads/'+channel+'/releases.json')).json()];
    agentPackages=agentDownloads(catalogs,channel);
    return agentPackages.map(({url,...item})=>item);
  });
  handle('agent:download-open',async(id:unknown)=>{
    if(typeof id!=='string')throw Error('请选择安装包');
    const item=agentPackages.find(p=>p.id===id);if(!item)throw Error('安装包列表已失效，请重新打开下载入口');
    await shell.openExternal(item.url);
  });
  handle('update:state', () => state);
  handle('update:open-page', () => shell.openExternal(releasesPage));
  const check = async () => {
    if (busy || operation) return state;
    busy = true;
    release = undefined;
    file = '';
    expected = '';
    state = {
      ...state,
      phase: 'checking',
      error: undefined,
      progress: undefined,
      version: undefined,
      retry: undefined,
    };
    try {
      release = selectRelease(
        await (await request(releaseApi)).json(),
        process.platform,
        process.arch, isPro,
      );
      file = '';
      expected = '';
      state = {
        ...state,
        version: release?.version,
        phase: !release
          ? 'unavailable'
          : compareVersion(release.version, state.current) > 0
            ? 'available'
            : 'current',
      };
    } catch (e) {
      fail(e, 'check');
    } finally {
      busy = false;
    }
    return state;
  };
  handle('update:check', check);
  const download = async () => {
    if (
      busy ||
      !release ||
      !(state.phase === 'available' || (state.phase === 'error' && state.retry === 'download'))
    )
      return state;
    busy = true;
    state = { ...state, phase: 'downloading', progress: 0, error: undefined, retry: undefined };
    const directory = join(app.getPath('userData'), 'updates'),
      target = join(directory, release.asset.name),
      part = target + '.part';
    try {
      await mkdir(directory, { recursive: true });
      expected = checksumFor(
        await (await request(release.checksums.browser_download_url)).text(),
        release.asset.name,
      );
      const response = await request(release.asset.browser_download_url, 600000);
      if (!response.body) throw new Error('Empty download');
      const handle = await open(part, 'w', 0o600),
        hash = createHash('sha256');
      let size = 0;
      try {
        for await (const chunk of response.body as any) {
          size += chunk.length;
          if (size > release.asset.size) throw new Error('Download size mismatch');
          hash.update(chunk);
          await handle.writeFile(chunk);
          state = { ...state, progress: Math.floor((size / release.asset.size) * 100) };
        }
      } finally {
        await handle.close();
      }
      if (size !== release.asset.size || hash.digest('hex') !== expected)
        throw new Error('SHA256 verification failed');
      await rename(part, target);
      file = target;
      state = { ...state, phase: 'ready', progress: 100 };
    } catch (e) {
      await rm(part, { force: true }).catch(() => {});
      fail(e, 'download');
    } finally {
      busy = false;
    }
    return state;
  };
  handle('update:download', download);
  const automatic = async () => {
    if(!state.automatic || busy || state.phase==='ready')return;
    await check();
    if(state.automatic && state.phase==='available')await download();
  };
  const settingsFile=join(app.getPath('userData'),'update-settings.json');
  const settingsReady=readFile(settingsFile,'utf8').then(raw=>{state.automatic=JSON.parse(raw).automatic!==false;}).catch(()=>{});
  handle('update:automatic',async(enabled:unknown)=>{
    if(typeof enabled!=='boolean')throw Error('更新设置格式不正确');
    await settingsReady;
    await writeFile(settingsFile,JSON.stringify({automatic:enabled}));state.automatic=enabled;
    if(enabled)void automatic();return state;
  });
  const initial=setTimeout(()=>void settingsReady.then(automatic),30000);initial.unref();
  const repeat=setInterval(()=>void settingsReady.then(automatic),6*60*60*1000);repeat.unref();
  // before-quit can be cancelled by the active-session close guard.
  // Keep checking for updates until the application actually exits.
  app.once('quit',()=>{clearTimeout(initial);clearInterval(repeat);});
  handle('update:install', async () => {
    if (busy || (operation && operation!=='install') || state.phase !== 'ready' || !file)
      throw new Error('Download and verify the update first');
    busy = true;
    try {
      if (
        createHash('sha256')
          .update(await readFile(file))
          .digest('hex') !== expected
      )
        throw new Error('Update file changed; download again');
      installAuthorization?.();
      if (process.platform === 'win32') {
        // The normal window close guard protects sessions; will-quit flushes
        // histories before the installer is launched from the final quit event.
        installAuthorization?.();
        const launch = () => {
          const installer = spawn(file, ['/S', '--force-run', '/D=' + dirname(app.getPath('exe'))], {
            detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true,
          });
          installer.on('error', error => console.error('Update installer failed to start', error));
          installer.unref();
        };
        app.once('quit', launch);
        queued = true;
        (window as EventEmitter).once('update-close-cancelled', () => { app.removeListener('quit', launch); queued = false; busy = false; });
        if(operation==='install')window.emit('update-mcp-approved');
        app.quit();
        return;
      }
      if (process.platform === 'linux') {
        const target = process.env.APPIMAGE || '';
        const staged = await prepareAppImageUpdate(file, target);
        try {installAuthorization?.();} catch(error) {await staged.cancel();throw error;}
        const launch = () => {
          try {
            staged.commit();
            const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.APPIMAGE; delete env.APPDIR;
            const child = spawn(target, [], { detached: true, stdio: 'ignore', env });
            child.on('error', error => console.error('Updated application could not restart', error)); child.unref();
          } catch (error) { console.error('Application update failed; previous executable retained', error); }
        };
        app.once('quit', launch); queued = true;
        (window as EventEmitter).once('update-close-cancelled', () => {
          app.removeListener('quit', launch); queued = false; busy = false; void staged.cancel();
        });
        if(operation==='install')window.emit('update-mcp-approved');
        app.quit(); return;
      }
      if (process.platform === 'darwin') {
        const staged = await prepareMacUpdate(file, app.getPath('exe'), release!.version);
        try {installAuthorization?.();} catch(error) {await staged.cancel();throw error;}
        const launch = () => {
          try {
            staged.commit();
            const child = spawn('/usr/bin/open', ['-n', staged.target], { detached: true, stdio: 'ignore' });
            child.on('error', error => console.error('Updated application could not restart', error)); child.unref();
          } catch (error) { console.error('Application update failed; previous application retained', error); }
        };
        app.once('quit', launch); queued = true;
        (window as EventEmitter).once('update-close-cancelled', () => { app.removeListener('quit', launch); queued = false; busy = false; void staged.cancel(); });
        if(operation==='install')window.emit('update-mcp-approved');
        app.quit(); return;
      }
      throw Error('当前平台尚不支持应用内安装');
    } catch (e) {
      window.emit('update-mcp-cancelled');
      file = '';
      fail(e, 'download');
      throw e;
    } finally {
      busy = queued;
    }
  });
  return applicationUpdateTool({
    ready:()=>receiptReady,
    state:()=>({update:state,operation,receipt:receipt.status()}),
    run:async(action,authorize)=>{
      await receiptReady;authorize();
      if(operation||busy)throw Error('An update operation is already running; poll status');
      if(action==='install'){
        if(state.phase!=='ready'||!file||!release)throw Error('Download and verify the update first');
        operation='install';
        try {
        if(createHash('sha256').update(await readFile(file)).digest('hex')!==expected)throw Error('Update file changed; download again');
        authorize();
        await receipt.save({targetVersion:release.version,previousVersion:app.getVersion(),channel:isPro?'pro':'opensource',requestedAt:Date.now(),phase:'scheduled'});
        authorize();installAuthorization=authorize;operation='install';
        setTimeout(()=>{void (async()=>{try{authorize();await handlers.get('update:install')!();}catch(e){operation=undefined;installAuthorization=undefined;await receipt.save({targetVersion:release?.version,phase:'failed',error:String(e)});}})().catch(e=>console.error('Update handoff receipt failed',e));},1500);
        return;
        } catch(e){operation=undefined;throw e;}
      }
      const pending=handlers.get('update:'+action)!();operation=action;
      void Promise.resolve(pending).catch(e=>fail(e,action)).finally(()=>{operation=undefined;});
    },
  });

}

