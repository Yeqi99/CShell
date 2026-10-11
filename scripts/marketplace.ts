import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { builtinPlugins, applications } from '../src/shared/plugins';
import { marketRoot } from '../src/shared/market';
await mkdir('marketplace/plugins', { recursive: true });
const entries = [];
for (const manifest of builtinPlugins) {
  const content = JSON.stringify(manifest, null, 2) + '\n';
  await writeFile(`marketplace/plugins/${manifest.id}.json`, content);
  entries.push({
    manifest,
    url: `${marketRoot}/plugins/${manifest.id}.json`,
    sha256: createHash('sha256').update(content).digest('hex'),
  });
}
await writeFile(
  'marketplace/plugins.json',
  JSON.stringify({ protocol: 1, plugins: entries }, null, 2) + '\n',
);
await writeFile(
  'marketplace/applications.json',
  JSON.stringify(
    {
      protocol: 1,
      applications: applications.map((app) => ({
        ...app,
        recipe: `cshell:${app.id}:1`,
        platforms: ['linux'],
      })),
    },
    null,
    2,
  ) + '\n',
);
