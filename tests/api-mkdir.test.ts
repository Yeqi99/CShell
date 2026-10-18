import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SFTPWrapper } from 'ssh2';
import { createSftpDirectory } from '../src/core/api/sftp-mkdir';
import { apiCallerPolicy, allowsCapability } from '../src/core/connections/authorization';
import { mcpSettingsSchema } from '../src/shared/contracts';

test('directory creation remains separately authorized for migrated file grants', () => {
  const settings = mcpSettingsSchema.parse({
    enabled: true,
    port: 3300,
    allowedProfiles: ['00000000-0000-4000-8000-000000000001'],
    allowCommands: false,
    capabilities: ['files.create'],
  });
  const target = { id: settings.allowedProfiles[0] };
  assert.equal(allowsCapability(apiCallerPolicy(settings, true), target, 'files.rename'), false);
  assert.equal(allowsCapability(apiCallerPolicy(settings, true), target, 'files.delete'), false);
  assert.equal(
    allowsCapability(apiCallerPolicy(settings, true), target, 'directories.create'),
    false,
  );
  settings.capabilities!.push('directories.create');
  assert.equal(
    allowsCapability(apiCallerPolicy(settings, true), target, 'directories.create'),
    true,
  );
  settings.targetPolicies = {
    [target.id]: { allowCommands: false, capabilities: [], review: 'authorized' },
  };
  assert.equal(
    allowsCapability(apiCallerPolicy(settings, true), target, 'directories.create'),
    false,
  );
});

test('mkdir cancellation before submission does nothing; after acknowledgement reports unknown without cleanup', async () => {
  const controller = new AbortController();
  let submissions = 0;
  const sftp = {
    mkdir: (path: string, attrs: { mode: number }, callback: (error?: Error) => void) => {
      submissions++;
      assert.equal(path, './new-dir');
      assert.equal(attrs.mode, 0o700);
      controller.abort();
      callback();
    },
  } as unknown as SFTPWrapper;
  await assert.rejects(createSftpDirectory(sftp, { path: './new-dir' }, controller.signal), {
    code: 'OUTCOME_UNKNOWN',
  });
  assert.equal(submissions, 1);
  await assert.rejects(createSftpDirectory(sftp, { path: './new-dir' }, controller.signal));
  assert.equal(submissions, 1);
});

test('mkdir preserves explicit server rejection and never retries ambiguous failures', async () => {
  for (const [status, code] of [
    [3, 'FORBIDDEN'],
    [11, 'CONFLICT'],
    [8, 'UNAVAILABLE'],
    [4, 'OUTCOME_UNKNOWN'],
  ] as const) {
    let attempts = 0;
    const sftp = {
      mkdir: (_path: string, _attrs: unknown, callback: (error: Error) => void) => {
        attempts++;
        callback(Object.assign(new Error('server reply'), { code: status }));
      },
    } as unknown as SFTPWrapper;
    await assert.rejects(
      createSftpDirectory(sftp, { path: 'new-dir' }, new AbortController().signal),
      { code },
    );
    assert.equal(attempts, 1);
  }
});
