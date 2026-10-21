import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const root = JSON.parse(await fs.readFile('package.json', 'utf8'));
const visited = new Map();
async function visit(name, from) {
  let manifest;
  try {
    manifest = createRequire(path.join(from, 'package.json')).resolve(`${name}/package.json`);
  } catch {
    try {
      let folder = path.dirname(createRequire(path.join(from, 'package.json')).resolve(name));
      while (!(await fs.stat(path.join(folder, 'package.json')).catch(() => null)))
        folder = path.dirname(folder);
      manifest = path.join(folder, 'package.json');
    } catch {
      return;
    }
  }
  let data = JSON.parse(await fs.readFile(manifest, 'utf8'));
  // Export maps may resolve package.json to dist/cjs/package.json (only a type marker).
  let parent = path.dirname(manifest);
  while (data.name !== name || !data.version) {
    const next = path.dirname(parent);
    if (next === parent) throw new Error('Could not locate license manifest for ' + name);
    parent = next;
    const candidate = path.join(parent, 'package.json');
    const content = await fs.readFile(candidate, 'utf8').catch(() => null);
    if (content) {
      data = JSON.parse(content);
      manifest = candidate;
    }
  }
  const key = `${data.name}@${data.version}`;
  if (visited.has(key)) return;
  const folder = path.dirname(manifest),
    licenseFiles = (await fs.readdir(folder)).filter((file) =>
      /^(license|licence|copying|notice)(\.|$)/i.test(file),
    );
  const notices = await Promise.all(
    licenseFiles.map(
      async (file) => `--- ${file} ---\n${await fs.readFile(path.join(folder, file), 'utf8')}`,
    ),
  );
  visited.set(key, {
    name: data.name,
    version: data.version,
    license:
      typeof data.license === 'string'
        ? data.license
        : data.license?.type || data.licenses?.map((item) => item.type).join(' OR ') || 'UNKNOWN',
    repository: typeof data.repository === 'object' ? data.repository.url : data.repository || '',
    notices: notices.join('\n\n'),
  });
  for (const dependency of Object.keys({ ...data.dependencies, ...data.optionalDependencies }))
    await visit(dependency, folder);
}
for (const name of [...Object.keys(root.dependencies), 'electron'])
  await visit(name, process.cwd());
const packages = [...visited.values()].sort((a, b) => a.name.localeCompare(b.name));
await fs.mkdir('docs', { recursive: true });
await fs.writeFile(
  'docs/dependency-licenses.json',
  JSON.stringify(
    packages.map(({ notices, ...record }) => record),
    null,
    2,
  ) + '\n',
);
await fs.writeFile(
  'THIRD_PARTY_NOTICES.txt',
  'CanpShell third-party dependency notices\nGenerated from locked installed package versions. The application source is licensed under MIT.\nElectron also ships its separate LICENSE and LICENSES.chromium.html files.\n\n' +
    packages
      .map(
        (p) =>
          `${p.name}@${p.version}\nDeclared license: ${p.license}\n${p.repository}\n${p.notices || 'No top-level license file found; consult package repository before redistribution.'}\n`,
      )
      .join('\n========================================\n\n'),
);
console.log(`${packages.length} dependency licenses recorded.`);
for (const p of packages)
  if (/UNKNOWN|GPL|AGPL|SSPL/.test(p.license)) console.log(`REVIEW: ${p.name} ${p.license}`);
