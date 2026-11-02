import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { openAsBlob, createReadStream } from 'node:fs';
import { readFile, mkdtemp, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';

const repository = 'Yeqi99/CShell', version = '0.8.19';
export function validatePlans(plans, expectedVersion = version) {
  assert.equal(plans.length, 2);
  assert.deepEqual(plans.map(p => p.edition).sort(), ['opensource', 'pro']);
  for (const p of plans) {
    assert.equal(p.status, 'candidate-not-published');
    assert.equal(p.version, expectedVersion);
    assert.match(p.sha, /^[a-f0-9]{40}$/);
    assert.equal(p.assets.length, p.edition === 'pro' ? 14 : 16);
    assert.equal(new Set(p.assets.map(a => a.name)).size, p.assets.length);
    for (const a of p.assets) {
      assert.match(a.name, /^(?:CAgent[-\w.]+\.(?:exe|tar\.gz)|CShell[-\w.]+\.(?:exe|dmg|zip|deb|AppImage|apk)|SHA256SUMS\.txt)$/);
      assert.match(a.sha256, /^[a-f0-9]{64}$/);
      assert(Number.isSafeInteger(a.size) && a.size > 0);
      if (a.name !== 'SHA256SUMS.txt') assert(a.name.includes(expectedVersion));
      if (a.name.startsWith('CShell')) assert.equal(a.name.startsWith('CShell-Pro-'), p.edition === 'pro');
    }
    assert.equal(p.assets.filter(a => a.name === 'SHA256SUMS.txt').length, 1);
  }
}
export function verifyRelease(release, plan, assets) {
  assert.equal(release.tag_name, plan.tag);
  assert.equal(release.target_commitish, plan.sha);
  assert.equal(release.prerelease, false);
  assert.equal(assets.length, plan.assets.length);
  assert.equal(new Set(assets.map(a => a.name)).size, assets.length);
  for (const a of plan.assets) { const x = assets.find(x => x.name === a.name); assert(x); assert.equal(x.size, a.size); assert.equal(x.digest, `sha256:${a.sha256}`); }
}
export function validateMarketPlan(p) {
  assert.equal(p.edition, 'toolkit'); assert.equal(p.version, '0.1.2');
  assert.equal(p.status, 'candidate-not-published'); assert.match(p.sha, /^[a-f0-9]{40}$/);
  const expected = ['4.1.15.56','4.2.0.12'].flatMap(v => [`Weixin-${v}-0.1.2.cagent-package.json`, `Weixin-${v}-0.1.2.manifest.json`, `WeixinToolkit-${v}-win-x64.zip`]).sort();
  assert.deepEqual(p.assets.map(a=>a.name).sort(), expected);
  for (const a of p.assets) { assert(Number.isSafeInteger(a.size) && a.size > 0); assert.match(a.sha256, /^[a-f0-9]{64}$/); }
}
const hash = async path => { const h = createHash('sha256'); for await (const b of createReadStream(path)) h.update(b); return h.digest('hex'); };
export function boundedPayload(size) {
  let received = 0;
  return new Transform({ transform(chunk, encoding, done) { received += chunk.length; done(received > size ? new Error('Origin payload exceeds verified size') : null, chunk); } });
}

export async function main() {
  // No mutation, downloads or credentials unless explicitly requested by the release job.
  const requested = process.argv[2] || '--check', market = requested.startsWith('--market-');
  const plans = market ? [JSON.parse(await readFile('services/update-edge/verified-wechat-012.json','utf8'))] : await Promise.all(['opensource', 'pro'].map(async edition => JSON.parse(await readFile(`services/update-edge/verified-${edition}-0819.json`, 'utf8'))));
  if (market) validateMarketPlan(plans[0]); else validatePlans(plans);
  const mode = market ? requested.replace('--market-', '--') : requested;
  assert(['--check', '--stage', '--publish'].includes(mode));
  if (mode === '--check') { console.log('Two channel manifests valid; no publication performed'); return; }
  assert.equal(process.env.GITHUB_REPOSITORY, repository);
  assert(process.env.GH_TOKEN, 'Release job token required');
  const headers = { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'CShell-verified-publication' };
  async function api(path, method = 'GET', body) {
    const r = await fetch(`https://api.github.com/repos/${repository}/${path}`, { method, headers, ...(body ? { body: JSON.stringify(body), headers: { ...headers, 'Content-Type': 'application/json' } } : {}), signal: AbortSignal.timeout(60000) });
    if (r.status === 404 && method === 'GET') return null;
    assert(r.ok, `GitHub ${method} ${path} returned ${r.status}`);
    return r.status === 204 ? null : r.json();
  }
  const releases = await api('releases?per_page=100');
  const work = await mkdtemp(join(tmpdir(), 'cshell-verified-publication-'));
  // All source refs and every complete payload are checked before creating either draft.
  for (const p of plans) {
    p.tag = market ? 'wechat-toolkit-v0.1.2' : `${p.edition === 'pro' ? 'pro-' : ''}v${version}`;
    p.notes = await readFile(market ? 'docs/RELEASE-NOTES-WECHAT-0.1.2.md' : `docs/RELEASE-NOTES-${p.edition === 'pro' ? 'PRO' : 'CORE'}-${version}.md`, 'utf8');
    assert(p.notes.trim().length > 100, 'Reviewed release notes required');
    assert.equal((await api(`commits/${p.sha}`))?.sha, p.sha);
    const tag = await api(`git/ref/tags/${p.tag}`);
    if (tag) { assert.equal(tag.object.type, 'commit'); assert.equal(tag.object.sha, p.sha); }
    const matches = releases.filter(r => r.tag_name === p.tag);
    assert(matches.length <= 1);
    if (matches.length) {
      assert.equal(matches[0].target_commitish, p.sha);
      if (!matches[0].draft) verifyRelease(matches[0], p, await api(`releases/${matches[0].id}/assets?per_page=100`));
    }
    p.release = matches[0];
    for (const a of p.assets) {
      const url = `https://shell.canp.ai/downloads/${p.edition}/v${p.version}/${a.name}`;
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(600000) });
      assert.equal(response.status, 200, `${p.edition}/${a.name}: origin not ready`);
      const length = response.headers.get('content-length');
      if (length !== null && Number(length) !== a.size) { await response.body.cancel(); throw new Error('Origin Content-Length differs from verified size'); }
      a.path = join(work, `${p.edition}-${a.name}`);
      await pipeline(Readable.fromWeb(response.body), boundedPayload(a.size), createWriteStream(a.path, { flags: 'wx' }));
      assert.equal((await stat(a.path)).size, a.size); assert.equal(await hash(a.path), a.sha256);
    }
    if (!market) {
      const sums = await readFile(p.assets.find(a => a.name === 'SHA256SUMS.txt').path, 'utf8');
      const expected = p.assets.filter(a => a.name !== 'SHA256SUMS.txt').map(a => `${a.sha256}  ${a.name}`).sort();
      assert.deepEqual(sums.trim().split(/\r?\n/).sort(), expected);
    }
  }
  for (const p of plans) {
    if (p.release && !p.release.draft) continue; // Exact existing public channel is read-only during interrupted-pair recovery.
    if (!p.release) p.release = await api('releases', 'POST', { tag_name: p.tag, target_commitish: p.sha, name: market ? 'Weixin Toolkit 0.1.2' : `CShell${p.edition === 'pro' ? ' Pro' : ''} ${version}`, draft: true, prerelease: false, body: p.notes });
    const existing = await api(`releases/${p.release.id}/assets?per_page=100`);
    for (const a of existing) { const expected = p.assets.find(e => e.name === a.name); assert(expected, 'Unexpected draft attachment'); assert.equal(a.size, expected.size); assert.equal(a.digest, `sha256:${expected.sha256}`); }
    for (const a of p.assets) {
      if (existing.some(e => e.name === a.name)) continue;
      const u = new URL(p.release.upload_url.split('{')[0]);
      assert.equal(u.origin, 'https://uploads.github.com'); assert.equal(u.pathname, `/repos/${repository}/releases/${p.release.id}/assets`);
      u.searchParams.set('name', a.name);
      const response = await fetch(u, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/octet-stream' }, body: await openAsBlob(a.path), signal: AbortSignal.timeout(600000), redirect: 'error' });
      assert(response.ok, `Attachment upload failed: ${response.status}`);
      const uploaded = await response.json(); assert.equal(uploaded.size, a.size); assert.equal(uploaded.digest, `sha256:${a.sha256}`);
    }
  }
  // Verify BOTH complete drafts before publishing either. Never switches update catalogs.
  for (const p of plans) {
    const draft = await api(`releases/${p.release.id}`);
    verifyRelease(draft, p, await api(`releases/${p.release.id}/assets?per_page=100`));
    p.release = draft;
  }
  if (mode === '--publish') for (const p of plans) { if (!p.release.draft) { console.log(`Already verified public: ${p.tag}; unchanged`); continue; } const result = await api(`releases/${p.release.id}`, 'PATCH', { draft: false }); assert.equal(result.draft, false); console.log(`Published ${p.tag} at verified source ${p.sha}`); }
  else console.log('Both drafts complete and verified; not published');
  await writeFile(join(work, 'receipt.json'), JSON.stringify(plans.map(p => ({ edition: p.edition, tag: p.tag, sha: p.sha, releaseId: p.release.id, published: mode === '--publish' })), null, 2));
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
