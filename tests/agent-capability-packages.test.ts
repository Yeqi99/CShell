import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CapabilityPackages, parseCapabilityManifest, verifyCapabilityFiles, type CapabilityPackageHost } from '../src/agent/capability-packages';
import type { CapabilityPackageRecord } from '../src/shared/agent-capability-packages';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const rawManifest = (changes = {}) => JSON.stringify({
  protocol: 1, id: 'test.fixture', name: 'Fixture', version: '1.0.0', license: 'MIT', description: 'Isolated test adapter',
  source: { repository: 'https://github.com/example/fixture', releaseTag: 'v1.0.0', assetUrl: 'https://github.com/example/fixture/releases/download/v1.0.0/fixture.zip' },
  compatibility: { platforms: ['win32'], architectures: ['x64'], agentVersion: { min: '0.6.9', maxExclusive: '1.0.0' } },
  adapterId: 'test.trusted', systemApplication: { id: 'fixture-app', version: { min: '1.0.0', maxExclusive: '2.0.0' } },
  files: [{ path: 'fixture.txt', sha256: sha('fixture'), bytes: 7 }],
  permissions: ['fixture.read'],
  tools: [{ id: 'fixture.read', description: 'Read fixture', inputSchema: { type: 'object' }, outputSchema: { type: 'object' }, permissions: ['fixture.read'], sideEffect: false }],
  events: [], ...changes,
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'capability-package-')); await writeFile(join(root, 'fixture.txt'), 'fixture');
  let saved: CapabilityPackageRecord[] = []; let installed = true, configured = true; let systemVersion = '1.2.0'; let stopFailure = false;
  const calls: string[] = [];
  const host: CapabilityPackageHost = {
    environment: { platform: 'win32', architecture: 'x64', agentVersion: '0.6.9' },
    hasAdapter: id => id === 'test.trusted', inspect: async () => ({ installed, configured, systemVersion }),
    register: async () => { calls.push('register'); }, quiesce: async () => { calls.push('quiesce'); },
    stopTasksAndSubscriptions: async () => { calls.push('stop'); if (stopFailure) throw new Error('cannot stop'); },
    unregister: async () => { calls.push('unregister'); }, load: async () => structuredClone(saved), save: async records => { saved = structuredClone(records); },
  };
  const manager = new CapabilityPackages(host); await manager.init();
  return { root, manager, host, calls, set: (value: { installed?: boolean; configured?: boolean; systemVersion?: string; stopFailure?: boolean }) => {
    installed = value.installed ?? installed; configured = value.configured ?? configured; systemVersion = value.systemVersion ?? systemVersion; stopFailure = value.stopFailure ?? stopFailure;
  }, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test('manifest authenticates exact bytes, restricts GitHub release source and refuses executable renderer metadata', () => {
  const raw = rawManifest(); assert.equal(parseCapabilityManifest(raw, sha(raw)).id, 'test.fixture');
  assert.throws(() => parseCapabilityManifest(raw + ' ', sha(raw)), /digest/);
  for (const changes of [ { renderer: 'evil.js' }, { source: { repository: 'https://github.com/example/fixture', releaseTag: 'v1', assetUrl: 'https://evil.example/payload.zip' } }, { license: 'unknown' } ]) {
    const invalid = rawManifest(changes); assert.throws(() => parseCapabilityManifest(invalid, sha(invalid)));
  }
});

test('portable paths reject traversal, ADS, reserved names and duplicate aliases', () => {
  for (const path of ['../escape', '/absolute', 'a\\b', 'file:stream', 'NUL.txt', 'folder/../escape', 'foo.']) {
    const raw = rawManifest({ files: [{ path, sha256: sha('fixture'), bytes: 7 }] }); assert.throws(() => parseCapabilityManifest(raw, sha(raw)), path);
  }
  const raw = rawManifest({ files: [{ path: 'X', sha256: sha(''), bytes: 0 }, { path: 'x', sha256: sha(''), bytes: 0 }] }); assert.throws(() => parseCapabilityManifest(raw, sha(raw)), /Duplicate/);
});

test('local content tampering is rejected before any adapter registration', async () => {
  const f = await setup();
  try {
    const raw = rawManifest(); await verifyCapabilityFiles(f.root, parseCapabilityManifest(raw, sha(raw)));
    await writeFile(join(f.root, 'fixture.txt'), 'changed');
    await assert.rejects(f.manager.stage(raw, f.root, sha(raw)), /digest/); assert.equal(f.calls.includes('register'), false);
  } finally { await f.cleanup(); }
});

test('installation, configuration and grants are independent lifecycle gates', async () => {
  const f = await setup();
  try {
    const raw = rawManifest(); f.set({ installed: false }); assert.equal((await f.manager.stage(raw, f.root, sha(raw))).status, 'not-installed');
    f.set({ installed: true, configured: false }); assert.equal((await f.manager.refresh('test.fixture')).status, 'not-configured');
    f.set({ configured: true }); assert.equal((await f.manager.refresh('test.fixture')).status, 'authorization-required'); assert.equal(f.calls.includes('register'), false);
    assert.equal((await f.manager.setPermissions('test.fixture', ['fixture.read'])).status, 'available');
    assert.equal((await f.manager.setPermissions('test.fixture', [])).status, 'authorization-required');
    await assert.rejects(f.manager.setPermissions('test.fixture', ['grant.everything']), /Unknown/);
  } finally { await f.cleanup(); }
});

test('platform, host adapter and system version incompatibility never appear available', async () => {
  const f = await setup();
  try {
    const raw = rawManifest(); f.host.environment.platform = 'linux'; assert.equal((await f.manager.stage(raw, f.root, sha(raw))).status, 'incompatible');
    f.host.environment.platform = 'win32'; f.set({ systemVersion: '2.0.0' }); assert.equal((await f.manager.refresh('test.fixture')).status, 'incompatible');
    f.set({ systemVersion: '1.2.0' }); const unavailable = rawManifest({ adapterId: 'unimplemented.wechat' }); assert.equal((await f.manager.stage(unavailable, f.root, sha(unavailable))).status, 'incompatible'); assert.equal(f.calls.includes('register'), false);
  } finally { await f.cleanup(); }
});

test('upgrade preserves only previous grants, new permission remains denied; restart requires fresh verification', async () => {
  const f = await setup();
  try {
    const raw = rawManifest(); await f.manager.stage(raw, f.root, sha(raw)); await f.manager.setPermissions('test.fixture', ['fixture.read']);
    const upgrade = rawManifest({ version: '1.1.0', permissions: ['fixture.read', 'fixture.write'] });
    const result = await f.manager.stage(upgrade, f.root, sha(upgrade)); assert.equal(result.status, 'available'); assert.deepEqual(result.grants, ['fixture.read']);
    const restored = new CapabilityPackages(f.host); await restored.init(); assert.equal(restored.list()[0].status, 'not-configured'); assert.equal(restored.list()[0].registered, false);
  } finally { await f.cleanup(); }
});

test('uninstall quiesces then stops subscriptions/tasks then unregisters; stop failure preserves fault record', async () => {
  const f = await setup();
  try {
    const raw = rawManifest(); await f.manager.stage(raw, f.root, sha(raw)); await f.manager.setPermissions('test.fixture', ['fixture.read']); f.calls.length = 0;
    f.set({ stopFailure: true }); await assert.rejects(f.manager.uninstall('test.fixture')); assert.deepEqual(f.calls, ['quiesce', 'stop']); assert.equal(f.manager.list()[0].status, 'fault');
    f.set({ stopFailure: false }); f.calls.length = 0; await f.manager.uninstall('test.fixture'); assert.deepEqual(f.calls, ['quiesce', 'stop', 'unregister']); assert.deepEqual(f.manager.list(), []);
  } finally { await f.cleanup(); }
});

test('failed registration blocks new calls and cleans partial registration', async () => {
  const f = await setup();
  try {
    const raw = rawManifest(); await f.manager.stage(raw, f.root, sha(raw)); f.host.register = async () => { f.calls.push('partial-register'); throw new Error('failed'); };
    const result = await f.manager.setPermissions('test.fixture', ['fixture.read']); assert.equal(result.status, 'fault'); assert.deepEqual(f.calls.slice(-4), ['partial-register', 'quiesce', 'stop', 'unregister']);
  } finally { await f.cleanup(); }
});
