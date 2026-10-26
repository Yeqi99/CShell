import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realpath, mkdtemp, writeFile, readFile, rm, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { deploymentFile, deploymentPackages, initialDesktopPlugins } from '../src/core/provisioning';
import { provisionAgent } from '../src/agent/provisioning';
import { ClientVault } from '../src/core/client/identity';
import { agentCodec } from '../src/agent/storage';
import { accessSchema, verifyPassword } from '../src/core/client/password';

test('desktop deployment accepts only known builtins, does not invent grants', () => {
  const config = { format: 'cshell-deployment-1', target: 'cshell', extensions: [{ id: 'cshell.classroom', enabled: true }, { id: 'cshell.docker', enabled: false }] };
  const plugins = initialDesktopPlugins(config);
  assert.equal(plugins[0].manifest.id, 'cshell.classroom');
  assert.equal(plugins[1].enabled, false);
  assert.throws(() => initialDesktopPlugins({ ...config, extensions: [{ id: 'other.fake', enabled: true }] }));
  assert.throws(() => initialDesktopPlugins({ ...config, extensions: [config.extensions[0], config.extensions[0]] }));
  assert.throws(() => initialDesktopPlugins({ ...config, permissions: { everything: true } }));
});

test('Agent preview is side-effect free; apply encrypts and upgrades preserve every existing byte', async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'cshell-provision-'));
  try {
    const destination = join(root, 'data'), file = join(root, 'deploy.json');
    const secret = 'a-private-password-123';
    await writeFile(join(root, 'password.txt'), secret + '\n', { mode: 0o600 });
    const config = { format: 'cshell-deployment-1', target: 'cagent', preset: 'classroom-student', lanDiscovery: { enabled: true, name: 'Student fixture', room: 'Classroom' }, passwordFile: 'password.txt', bind: '0.0.0.0', listenOnLaunch: true, port: 24555, shells: ['sh'], permissions: { manage: true, http: false, hosting: false, relay: false } };
    await writeFile(file, JSON.stringify(config));
    const preview = await provisionAgent(file, destination);
    assert.equal(preview.applied, false);
    await assert.rejects(lstat(destination), { code: 'ENOENT' });
    assert.ok(!JSON.stringify(preview).includes(secret));
    const result = await provisionAgent(file, destination, true);
    assert.equal(result.applied, true);
    assert.equal('remoteListenerStarted' in result && result.remoteListenerStarted, false);
    const codec = await agentCodec(destination), vault = new ClientVault(destination, codec);
    const record = await vault.read('access', accessSchema);
    assert.ok(record && await verifyPassword(secret, record));
    assert.equal(record.allowHttp, false);
    assert.equal(await vault.read('connection-resume-listener', z.boolean()), true);
    assert.equal((await vault.read('lan-registration', z.object({ name: z.string() })))?.name, 'Student fixture');
    assert.deepEqual(await vault.read('desktop-config', z.object({ enabled: z.boolean(), authenticatedPeers: z.boolean(), directListener: z.boolean() })), { enabled: true, authenticatedPeers: true, directListener: false });
    assert.equal((await vault.read('listener', z.object({ port: z.number() })))?.port, 24555);
    assert.ok(!(await readFile(join(destination, 'connection-password.enc'), 'utf8')).includes(secret));
    const before = await readFile(join(destination, 'identity.enc'));
    await writeFile(file, JSON.stringify({ ...config, port: 29999, passwordFile: 'missing.txt' }));
    const preserved = await provisionAgent(file, destination, true);
    assert.equal(preserved.applied, false);
    assert.deepEqual(await readFile(join(destination, 'identity.enc')), before);
    assert.equal((await vault.read('listener', z.object({ port: z.number() })))?.port, 24555);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('invalid secrets and package digests fail before creating data', async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'cshell-provision-invalid-'));
  try {
    const path = join(root, 'config.json');
    await writeFile(path, JSON.stringify({ format: 'cshell-deployment-1', target: 'cshell', extensions: [], password: 'do-not-print-secret' }));
    await assert.rejects(deploymentFile(path), error => !String(error).includes('do-not-print-secret'));
    await writeFile(join(root, 'bad.cshellext'), '{}');
    await writeFile(path, JSON.stringify({ format: 'cshell-deployment-1', target: 'cshell', extensions: [], packages: [{ file: 'bad.cshellext', sha256: '0'.repeat(64) }] }));
    await assert.rejects(deploymentPackages(await deploymentFile(path)), /摘要/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
