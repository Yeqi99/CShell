import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const version = JSON.parse(await readFile('package.json', 'utf8')).version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid version');
const token = process.env.GH_TOKEN;
if (!token) throw new Error('GH_TOKEN required to verify draft assets');
const repository = 'Yeqi99/CShell';
const api = `https://api.github.com/repos/${repository}`;
const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'CShell-release-verifier',
};
// The tag lookup does not expose a draft whose tag has not been published yet.
const response = await fetch(`${api}/releases?per_page=100`, {
  headers,
  signal: AbortSignal.timeout(30000),
});
if (!response.ok) throw new Error(`Release lookup failed: ${response.status}`);
const releases = await response.json();
const matches = releases.filter((entry) => entry.tag_name === `v${version}` && entry.draft);
if (matches.length !== 1) throw new Error('Expected exactly one matching release draft');
const release = matches[0];
if (release.tag_name !== `v${version}` || !release.draft)
  throw new Error('Expected an unpublished release draft');
if (process.env.CSHELL_RELEASE_SHA && release.target_commitish !== process.env.CSHELL_RELEASE_SHA)
  throw new Error('Draft source does not match the verified build');
const directory = process.argv[2] || 'packages';
const names = (await readdir(directory)).sort();
if (!names.includes('SHA256SUMS.txt') || !names.length) throw new Error('Missing local checksums');
if (release.assets.length !== names.length)
  throw new Error('Uploaded package count differs from verified local output');
for (const name of names) {
  const file = join(directory, name),
    info = await lstat(file);
  if (!info.isFile()) throw new Error('Release output contains a non-file');
  const asset = release.assets.find((a) => a.name === name);
  if (!asset || asset.state !== 'uploaded' || asset.size !== info.size)
    throw new Error(`Incomplete upload: ${name}`);
  const local = createHash('sha256');
  for await (const chunk of createReadStream(file)) local.update(chunk);
  const expected = local.digest('hex');
  if (asset.digest) {
    if (asset.digest !== `sha256:${expected}`) throw new Error(`Remote checksum mismatch: ${name}`);
  } else {
    // Older GitHub deployments may not report a server-side digest.
    if (!Number.isSafeInteger(asset.id)) throw new Error('Invalid asset ID');
    const download = await fetch(`${api}/releases/assets/${asset.id}`, {
      headers: { ...headers, Accept: 'application/octet-stream' },
      signal: AbortSignal.timeout(300000),
    });
    if (!download.ok || !download.body) throw new Error(`Could not verify upload: ${name}`);
    const remote = createHash('sha256');
    let bytes = 0;
    for await (const chunk of download.body) {
      bytes += chunk.length;
      if (bytes > info.size) throw new Error(`Downloaded asset too large: ${name}`);
      remote.update(chunk);
    }
    if (bytes !== info.size || remote.digest('hex') !== expected)
      throw new Error(`Downloaded checksum mismatch: ${name}`);
  }
  console.log(`Verified uploaded ${name}`);
}
console.log('All uploaded assets match the verified packages. Draft can be published.');
