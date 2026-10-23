import { app, net } from 'electron';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { CloudSync } from '../core/cloud-sync';
import type { Store } from '../core/store';
import type { AiService } from '../core/ai';
import type { ClientProvider } from '../core/client/provider';
import type { HttpWorkspaces } from '../core/http-workspaces';
import { clientCodec } from './client-app';
import { defaults } from '../shared/contracts';
import { emptySharedAi } from '../shared/shared-ai';
import type { DesktopAccountProfiles } from '../core/desktop-account-profiles';
import {AccountWorkspaceMismatch} from '../core/desktop-account-profiles';
import {registerAccountImports} from './account-import';

const assetName = z.string().regex(/^[a-f0-9]{64}\.(?:ttf|otf|woff|woff2|png)$/);
const bundleSchema = z
  .object({
    format: z.literal(1),
    store: z.unknown(),
    ai: z.unknown(),
    devices: z.unknown(),
    http: z.unknown(),
    browser: z.unknown().optional(),
    opencode: z.unknown().optional(),
    assets: z.record(assetName, z.string().max(11 * 1024 * 1024)).default({}),
  })
  .strict();

export async function registerCloudHandlers(
  handle: (name: string, fn: (...args: any[]) => any) => void,
  store: Store,
  ai: AiService,
  client: ClientProvider,
  http: HttpWorkspaces,
  publish: () => void,
  browser: import('./machine-browser').MachineBrowser,
  openCode: import('../extensions/opencode/service').OpenCodeExtension,
  profileOptions?:{profiles:DesktopAccountProfiles;assertIdle():void;block(value:boolean):void},
  network?: import('./network-route').ApplicationNetworkRoute,
) {
  const directory = app.getPath('userData');
  const assertAccountIdle=()=>{profileOptions?.assertIdle();if(ai.snapshot().threads.some(t=>t.state==='running'||t.state==='approval'||t.goal?.state==='active'))throw Error('请先停止智能体任务，再切换账号');};
  const snapshot = async () => {
    const data = await store.cloudExport(),
      assets: Record<string, string> = {};
    for (const preferences of [data.preferences, ...data.presets.map((p) => p.preferences)]) {
      for (const asset of [
        preferences.backgroundAsset,
        preferences.uiFontAsset,
        preferences.terminalFontAsset,
      ]) {
        if (!asset || assets[asset.id]) continue;
        assetName.parse(asset.id);
        const bytes = await readFile(join(directory, 'appearance', asset.id));
        if (bytes.length > 8 * 1024 * 1024) throw new Error('外观资源超过首版同步的 8 MiB 上限');
        assets[asset.id] = bytes.toString('base64');
      }
    }
    return {
      format: 1,
      store: data,
      ai: ai.cloudExport(),
      opencode: await openCode.cloudExport(),
      devices: client.cloudExport(),
      browser: await browser.cloudExport(),
      http: http.cloudExport(),
      assets,
    };
  };
  const validate = (value: unknown) => {
    const data = bundleSchema.parse(value);
    store.cloudValidate(data.store);
    ai.cloudValidate(data.ai);
    if(data.opencode!==undefined)openCode.cloudValidate(data.opencode);
    client.cloudValidate(data.devices);
    http.cloudValidate(data.http);
    if(data.browser!==undefined)browser.cloudValidate(data.browser);
    for (const [name, encoded] of Object.entries(data.assets)) {
      const bytes = Buffer.from(encoded, 'base64');
      if (createHash('sha256').update(bytes).digest('hex') !== name.split('.')[0])
        throw new Error('云端外观资源校验失败');
    }
    return data;
  };
  const apply = async (value: unknown, rollback = false) => {
    const data = validate(value);
    await mkdir(join(directory, 'appearance'), { recursive: true });
    for (const [name, encoded] of Object.entries(data.assets))
      await writeFile(join(directory, 'appearance', name), Buffer.from(encoded, 'base64'));
    await client.cloudImport(data.devices);
    await http.cloudImport(data.http);
    if(data.opencode!==undefined)await openCode.cloudImport(data.opencode);
    await ai.cloudImport(data.ai);
    await store.cloudImport(data.store,rollback);
    if(data.browser!==undefined)await (rollback?browser.cloudRestore(data.browser):browser.cloudImport(data.browser));
  };
  const cloud = new CloudSync(directory, clientCodec, {
    ...(profileOptions?{
      registrationSnapshot:async()=>({format:1,store:{profiles:[],groups:[],preferences:defaults,presets:[],monitorViews:[],hosts:{},secrets:{}},ai:emptySharedAi(),devices:[],http:[],browser:{},opencode:{accounts:[]},assets:{}}),
      activationTarget:async(accountId:string|undefined)=>{
        assertAccountIdle();const target=await profileOptions.profiles.prepare(accountId);
        return {directory:target.directory,commit:async()=>{
          assertAccountIdle();profileOptions.block(true);
          try{await target.commit();}catch(error){profileOptions.block(false);throw error;}
          setImmediate(()=>{app.relaunch();app.quit();});
        }};
      },
    }:{}),
    export: snapshot,
    validate,
    import: async (value) => {
      const previous = await snapshot();
      try {
        await apply(value);
      } catch (error) {
        await apply(previous,true);
        throw error;
      }
      publish();
    },
  }, undefined, (url, options) => net.fetch(String(url), options));
  await cloud.load();
  if(profileOptions){
    try{await profileOptions.profiles.initialize(cloud.accountId());}
    catch(error){
      if(!(error instanceof AccountWorkspaceMismatch))throw error;
      profileOptions.block(true);
      await cloud.quarantineWorkspaceSession();
      const guest=await profileOptions.profiles.prepare();await guest.commit();
      await writeFile(join(guest.directory,'account-recovery.json'),JSON.stringify({version:1,at:new Date().toISOString()}),{mode:0o600});
      app.relaunch();
      const restart=new Error('Account workspace recovered; restarting safely');restart.name='AccountWorkspaceRestart';throw restart;
    }
  }
  if(profileOptions)registerAccountImports(handle,cloud,profileOptions.profiles,validate,snapshot,assertAccountIdle);
  ai.officialCredential=()=>cloud.sessionCredential();
  if (network) {
    const { createSshBrowserProxy } = await import('../core/ssh-browser-proxy');
    const { agentBrowserStream } = await import('../core/agent-browser-stream');
    const proxies = new Map<string, Awaited<ReturnType<typeof createSshBrowserProxy>>>();
    network.machine = {
      list: async () => client.cloudExport().filter(device => device.accountManaged).map(device => ({ id: device.deviceId, name: device.name })),
      proxy: async id => {
        if (!client.cloudExport().some(device => device.deviceId === id && device.accountManaged)) throw Error('账号机器不可用，未回退本机网络');
        // The server checks current membership and device ownership, including reused proxy listeners.
        await cloud.accountRequest('/v1/devices/lease', { deviceId: id });
        let proxy = proxies.get(id);
        if (!proxy) {
          proxy = await createSshBrowserProxy((host, port, done) => {
            void (async () => {
              await cloud.accountRequest('/v1/devices/lease', { deviceId: id });
              const transport = await client.browserTransport(id);
              try {
                const stream = await agentBrowserStream(transport.call, host, port);
                stream.once('close', () => transport.close());
                return stream;
              } catch (error) { transport.close(); throw error; }
            })().then(stream => done(null, stream), error => done(error));
          });
          proxies.set(id, proxy);
        }
        return 'socks5://127.0.0.1:' + proxy.port;
      },
    };
    app.once('before-quit', () => { for (const proxy of proxies.values()) proxy.close(); proxies.clear(); });
  }
  client.cloudLease=async id=>{const result=await cloud.accountRequest('/v1/devices/lease',{deviceId:id});return (await import('../shared/agent-relay')).agentRelayConnectionSchema.parse(result.relay);};
  handle('cloud:memory',()=>ai.memory());
  handle('cloud:remember',input=>ai.remember(input));
  handle('cloud:forget',id=>ai.forget(id));
  const workspaceRecovered=await readFile(join(directory,'account-recovery.json'),'utf8').then(()=>true,()=>false);
  handle('cloud:status', async () => ({...await cloud.accountStatus(),...(workspaceRecovered?{workspaceRecovered:true}:{})}));
  handle('cloud:code', (email) => cloud.requestCode(z.email().max(254).parse(email)));
  handle('cloud:register',(email,code,password)=>cloud.register(z.email().max(254).parse(email),z.string().regex(/^\d{6}$/).parse(code),z.string().min(8).max(128).parse(password)));
  handle('cloud:login', (email, code, password = false) =>
    cloud.login(
      z.email().max(254).parse(email),
      (password === true ? z.string().min(8).max(128) : z.string().regex(/^\d{6}$/)).parse(code),
      password === true,
    ),
  );
  handle('cloud:unlock', (key) => cloud.unlock(z.string().max(100).parse(key)));
  handle('cloud:create', () => cloud.createVault());
  handle('cloud:sync', (direction) =>
    cloud.sync(z.enum(['upload', 'download']).optional().parse(direction)),
  );
  handle('cloud:logout', () => {assertAccountIdle();return cloud.logout();});
  let refreshing=false,modelsChecked=0;
  const tick=async()=>{if(refreshing||cloud.activationDeferred())return;refreshing=true;try{await cloud.autoSync();if(!cloud.activationDeferred()&&cloud.status().email&&Date.now()-modelsChecked>60000){const catalog=await cloud.accountRequest('/v1/models');if(await ai.ensureOfficialModels(catalog.models.map((m:{id:string})=>m.id)))publish();modelsChecked=Date.now();}}catch{}finally{refreshing=false;}};
  void tick();
  const timer = setInterval(() => { void tick(); }, 15000);
  timer.unref();
  app.once('before-quit', () => clearInterval(timer));
}
