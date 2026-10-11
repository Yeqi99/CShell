import { createHash } from 'node:crypto';
import {
  builtinPlugins,
  catalogSchema,
  pluginManifestSchema,
  type CatalogEntry,
} from '../shared/plugins';
import type { Store } from './store';
import { marketRoot } from '../shared/market';
function trustedBuiltin(entry: CatalogEntry) {
  const expected = builtinPlugins.find((p) => p.id === entry.manifest.id);
  return (
    !!expected &&
    entry.url === `${marketRoot}/plugins/${expected.id}.json` &&
    JSON.stringify(expected) === JSON.stringify(entry.manifest)
  );
}

export async function httpsText(address: string, limit = 512_000) {
  const url = new URL(address);
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('HTTPS URL required');
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (!response.body) throw new Error('Empty response');
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error('Download exceeds size limit');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks).toString('utf8');
}
export class PluginService {
  private writes: Promise<unknown> = Promise.resolve();
  constructor(private store: Store) {}
  private serial(fn: () => Promise<void>) {
    const next = this.writes.catch(() => {}).then(fn);
    this.writes = next;
    return next;
  }
  install(id: string) {
    return this.serial(async () => {
      const manifest = builtinPlugins.find((p) => p.id === id);
      if (!manifest) throw new Error('Unknown bundled plugin');
      const plugins = this.store.plugins().filter((p) => p.manifest.id !== id);
      await this.store.setPlugins([...plugins, { manifest, enabled: true, source: 'bundled' }]);
    });
  }
  toggle(id: string, enabled: boolean) {
    return this.serial(async () => {
      const plugins = this.store.plugins();
      const item = plugins.find((p) => p.manifest.id === id);
      if (!item) throw new Error('Plugin is not installed');
      item.enabled = enabled;
      await this.store.setPlugins(plugins);
    });
  }
  remove(id: string) {
    return this.serial(() =>
      this.store.setPlugins(this.store.plugins().filter((p) => p.manifest.id !== id)),
    );
  }
  async catalog(url: string) {
    const entries = catalogSchema.parse(JSON.parse(await httpsText(url))).plugins;
    if (
      new Set(entries.map((e) => e.manifest.id)).size !== entries.length ||
      entries.some(
        (e) =>
          !trustedBuiltin(e) &&
          (e.manifest.id.startsWith('cshell.') ||
            e.manifest.provider !== 'snippets' ||
            e.manifest.permissions.some((p) => p !== 'terminal.input')),
      )
    )
      throw new Error('Unsupported or duplicate plugin in external catalog');
    await this.store.setPluginSource({ url, entries });
    return entries;
  }
  async download(input: CatalogEntry) {
    const entry = catalogSchema.shape.plugins.element.parse(input);
    const text = await httpsText(entry.url);
    if (createHash('sha256').update(text).digest('hex') !== entry.sha256)
      throw new Error('Plugin checksum mismatch');
    const manifest = pluginManifestSchema.parse(JSON.parse(text));
    if (JSON.stringify(manifest) !== JSON.stringify(entry.manifest))
      throw new Error('Package differs from catalog');
    if (
      !trustedBuiltin(entry) &&
      (manifest.id.startsWith('cshell.') ||
        manifest.provider !== 'snippets' ||
        manifest.permissions.some((p) => p !== 'terminal.input'))
    )
      throw new Error('External packages may only contribute command snippets');
    await this.serial(async () =>
      this.store.setPlugins([
        ...this.store.plugins().filter((p) => p.manifest.id !== manifest.id),
        { manifest, enabled: true, source: entry.url },
      ]),
    );
  }
}
