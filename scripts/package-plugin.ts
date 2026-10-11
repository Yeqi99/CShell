import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pluginManifestSchema, catalogSchema } from '../src/shared/plugins';
const [source, url, output] = process.argv.slice(2);
if (!source || !url || !output)
  throw new Error(
    'Usage: package-plugin <manifest.json> <https-package-url> <catalog-output.json>',
  );
const bytes = await readFile(source);
const manifest = pluginManifestSchema.parse(JSON.parse(bytes.toString('utf8')));
if (
  manifest.provider !== 'snippets' ||
  manifest.id.startsWith('cshell.') ||
  manifest.permissions.some((p) => p !== 'terminal.input')
)
  throw new Error('Only third-party command snippet packages are supported');
const catalog = catalogSchema.parse({
  protocol: 1,
  plugins: [{ manifest, url, sha256: createHash('sha256').update(bytes).digest('hex') }],
});
await writeFile(output, JSON.stringify(catalog, null, 2) + '\n', { flag: 'wx' });
console.log(`Validated ${manifest.id}@${manifest.version}; catalog written to ${output}`);
