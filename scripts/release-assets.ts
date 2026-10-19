import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, lstat, mkdir, open, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function desktopReleaseAssets(version: string): string[] {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid release version');
  return [
    'win-x64.exe',
    'mac-arm64.dmg',
    'mac-arm64.zip',
    'mac-x64.dmg',
    'mac-x64.zip',
    'linux-x86_64.AppImage',
    'linux-amd64.deb',
    'linux-arm64.AppImage',
    'linux-arm64.deb',
    'android-test.apk',
  ].map((suffix) => `CShell-${version}-${suffix}`);
}

export function agentReleaseAssets(version: string): string[] {
  desktopReleaseAssets(version); // Apply the same strict version check.
  return [
    'win-x64.exe',
    'mac-arm64.tar.gz',
    'mac-x64.tar.gz',
    'linux-x64.tar.gz',
    'linux-arm64.tar.gz',
  ].map((suffix) =>
    suffix === 'win-x64.exe' ? `CAgent-Setup-${version}-${suffix}` : `CAgent-${version}-${suffix}`,
  );
}

async function inspectPackage(path: string) {
  const info = await lstat(path);
  if (!info.isFile() || info.size < 1024) throw new Error(`Invalid package: ${basename(path)}`);
  const file = await open(path, 'r');
  try {
    const header = Buffer.alloc(8);
    await file.read(header, 0, header.length, 0);
    let valid = false;
    if (path.endsWith('.exe')) valid = header.subarray(0, 2).toString() === 'MZ';
    if (/\.(zip|apk)$/.test(path))
      valid = header.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 3, 4]));
    if (path.endsWith('.tar.gz'))
      valid = header[0] === 0x1f && header[1] === 0x8b && header[2] === 8;
    if (path.endsWith('.deb')) valid = header.toString() === '!<arch>\n';
    if (path.endsWith('.AppImage'))
      valid = header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
    if (path.endsWith('.dmg')) {
      const trailer = Buffer.alloc(4);
      await file.read(trailer, 0, 4, info.size - 512);
      valid = trailer.toString() === 'koly';
    }
    if (!valid) throw new Error(`Package format mismatch: ${basename(path)}`);
  } finally {
    await file.close();
  }
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return { size: info.size, sha256: hash.digest('hex') };
}

export async function verifyReleaseAssets(directory: string, expected: string[]) {
  const found = new Map<string, string>();
  async function walk(path: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const full = join(path, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Release inputs must not contain symbolic links');
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) {
        if (!expected.includes(entry.name))
          throw new Error(`Unexpected release file: ${entry.name}`);
        if (found.has(entry.name)) throw new Error(`Duplicate release file: ${entry.name}`);
        found.set(entry.name, full);
      }
    }
  }
  await walk(directory);
  const missing = expected.filter((name) => !found.has(name));
  if (missing.length) throw new Error(`Missing release packages: ${missing.join(', ')}`);
  const results = [];
  for (const name of [...expected].sort()) {
    const path = found.get(name)!;
    results.push({ name, path, ...(await inspectPackage(path)) });
  }
  return results;
}

async function main() {
  const version = JSON.parse(await readFile('package.json', 'utf8')).version as string;
  if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== `v${version}`)
    throw new Error('Release tag does not match package.json');
  const input = resolve(process.argv[2] || 'artifacts');
  const output = resolve(process.argv[3] || 'packages');
  const packages = await verifyReleaseAssets(input, [
    ...desktopReleaseAssets(version),
    ...agentReleaseAssets(version),
  ]);
  // Never mix new output with packages from a previous build.
  await mkdir(output);
  for (const item of packages) await copyFile(item.path, join(output, item.name));
  await writeFile(
    join(output, 'SHA256SUMS.txt'),
    packages.map((p) => `${p.sha256}  ${p.name}\n`).join(''),
  );
  console.log(
    JSON.stringify({ version, packages: packages.map(({ path: _path, ...p }) => p) }, null, 2),
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main();
