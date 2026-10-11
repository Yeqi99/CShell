import { dialog, type BrowserWindow } from 'electron';
import { readFile, writeFile, stat, mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Store } from '../core/store';
import { appearanceAssetSchema, preferencesSchema } from '../shared/contracts';
const bundleSchema = z
  .object({
    version: z.literal(1),
    name: z.string().min(1).max(80),
    preferences: preferencesSchema,
    assets: z
      .array(
        z.object({ id: appearanceAssetSchema.shape.id, data: z.string().max(28_000_000) }).strict(),
      )
      .max(3),
  })
  .strict();
export function registerPresetHandlers(
  handle: (name: string, fn: (...args: any[]) => any) => void,
  window: BrowserWindow,
  directory: string,
  store: Store,
  text: (cn: string, en: string) => string,
) {
  handle('presets:list', () => store.presets());
  handle('presets:save', (name, preferences) =>
    store.savePreset(
      z.string().trim().min(1).max(80).parse(name),
      preferencesSchema.parse(preferences),
    ),
  );
  handle('presets:delete', (id) => store.deletePreset(z.string().uuid().parse(id)));
  handle('presets:export', async (value) => {
    const preferences = preferencesSchema.parse(value);
    const file = await dialog.showSaveDialog(window, {
      title: text('导出工作区配置', 'Export workspace preset'),
      defaultPath: 'CShell-workspace.json',
      filters: [{ name: 'CShell', extensions: ['json'] }],
    });
    if (file.canceled || !file.filePath) return false;
    const assets: { id: string; data: string }[] = [];
    for (const asset of [
      preferences.uiFontAsset,
      preferences.terminalFontAsset,
      preferences.backgroundAsset,
    ])
      if (asset && !assets.some((item) => item.id === asset.id))
        assets.push({
          id: asset.id,
          data: (await readFile(join(directory, 'appearance', asset.id))).toString('base64'),
        });
    await writeFile(
      file.filePath,
      JSON.stringify(
        { version: 1, name: basename(file.filePath, '.json').slice(0, 80), preferences, assets },
        null,
        2,
      ),
    );
    return true;
  });
  handle('presets:import', async () => {
    const file = await dialog.showOpenDialog(window, {
      title: text('导入工作区配置', 'Import workspace preset'),
      properties: ['openFile'],
      filters: [{ name: 'CShell', extensions: ['json'] }],
    });
    if (file.canceled) return null;
    if ((await stat(file.filePaths[0])).size > 85_000_000)
      throw new Error(text('配置文件过大', 'Preset file is too large'));
    const bundle = bundleSchema.parse(JSON.parse(await readFile(file.filePaths[0], 'utf8')));
    const references = [
      bundle.preferences.uiFontAsset,
      bundle.preferences.terminalFontAsset,
      bundle.preferences.backgroundAsset,
    ].filter((asset) => asset !== null);
    for (const reference of references)
      if (!bundle.assets.some((asset) => asset.id === reference.id))
        throw new Error('Missing preset asset');
    if (
      bundle.preferences.backgroundAsset &&
      !bundle.preferences.backgroundAsset.id.endsWith('.png')
    )
      throw new Error('Invalid background asset');
    for (const font of [bundle.preferences.uiFontAsset, bundle.preferences.terminalFontAsset])
      if (font?.id.endsWith('.png')) throw new Error('Invalid font asset');
    const validated = bundle.assets.map((asset) => {
      const bytes = Buffer.from(asset.data, 'base64'),
        extension = asset.id.split('.').at(-1)!;
      if (
        bytes.length > 20 * 1024 * 1024 ||
        createHash('sha256').update(bytes).digest('hex') !== asset.id.split('.')[0]
      )
        throw new Error('Preset asset integrity failed');
      const magic: Record<string, string[]> = {
        png: ['89504e47'],
        ttf: ['00010000', '74727565'],
        otf: ['4f54544f'],
        woff: ['774f4646'],
        woff2: ['774f4632'],
      };
      if (!magic[extension]?.includes(bytes.subarray(0, 4).toString('hex')))
        throw new Error('Invalid preset asset');
      return { id: asset.id, bytes };
    });
    await mkdir(join(directory, 'appearance'), { recursive: true });
    for (const asset of validated)
      await writeFile(join(directory, 'appearance', asset.id), asset.bytes, { mode: 0o600 });
    // Import is a preview; the user explicitly saves a named preset or applies it.
    return { id: randomUUID(), name: bundle.name, preferences: bundle.preferences };
  });
}
