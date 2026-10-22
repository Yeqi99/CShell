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

const assetName = z.string().regex(/^[a-f0-9]{64}\.(?:ttf|otf|woff|woff2|png)$/);
const bundleSchema = z
  .object({
    format: z.literal(1),
    store: z.unknown(),
    ai: z.unknown(),
    devices: z.unknown(),
    http: z.unknown(),
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
) {
  const directory = app.getPath('userData');
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
      devices: client.cloudExport(),
      http: http.cloudExport(),
      assets,
    };
  };
  const validate = (value: unknown) => {
    const data = bundleSchema.parse(value);
    store.cloudValidate(data.store);
    ai.cloudValidate(data.ai);
    client.cloudValidate(data.devices);
    http.cloudValidate(data.http);
    for (const [name, encoded] of Object.entries(data.assets)) {
      const bytes = Buffer.from(encoded, 'base64');
      if (createHash('sha256').update(bytes).digest('hex') !== name.split('.')[0])
        throw new Error('云端外观资源校验失败');
    }
    return data;
  };
  const apply = async (value: unknown) => {
    const data = validate(value);
    await mkdir(join(directory, 'appearance'), { recursive: true });
    for (const [name, encoded] of Object.entries(data.assets))
      await writeFile(join(directory, 'appearance', name), Buffer.from(encoded, 'base64'));
    await client.cloudImport(data.devices);
    await http.cloudImport(data.http);
    await ai.cloudImport(data.ai);
    await store.cloudImport(data.store);
  };
  const cloud = new CloudSync(directory, clientCodec, {
    export: snapshot,
    validate,
    import: async (value) => {
      const previous = await snapshot();
      try {
        await apply(value);
      } catch (error) {
        await apply(previous);
        throw error;
      }
      publish();
    },
  }, undefined, (url, options) => net.fetch(String(url), options));
  await cloud.load();
  handle('cloud:status', () => cloud.accountStatus());
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
  handle('cloud:logout', () => cloud.logout());
  void cloud.autoSync();
  const timer = setInterval(() => { void cloud.autoSync(); }, 15000);
  timer.unref();
  app.once('before-quit', () => clearInterval(timer));
}
