import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClientVault } from '../src/core/client/identity';
import { IdeService } from '../src/agent/ide';
test('IDE remains unavailable without a verified engine and rejects stale plans and unauthorized owners', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cshell-ide-'));
  const vault = new ClientVault(directory, {
    encrypt: async (s) => Buffer.from(s).toString('base64'),
    decrypt: async (s) => Buffer.from(s, 'base64').toString(),
  });
  const service = new IdeService(vault, directory, (owner) => owner === 'owner');
  await service.load();
  const status = (await service.call('ide.status', {}, 'owner')) as any;
  assert.equal(status.ready, false);
  assert.equal(status.running, undefined);
  await assert.rejects(service.call('ide.status', {}, 'other'), /未授权/);
  await assert.rejects(service.call('ide.start', { cwd: directory }, 'owner'), /安装/);
  await assert.rejects(
    service.call(
      'ide.install',
      { id: '11111111-1111-4111-8111-111111111111', confirm: true },
      'owner',
    ),
    /过期/,
  );
  await assert.rejects(service.call('ide.start', { cwd: '.' }, 'owner'), /目录/);
  service.close();
});
