import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VirtualDisplayBackend } from '../src/agent/virtual-display';

const host = { platform: 'win32', arch: 'x64', build: 26200, server: false };
test('virtual display platform and explicit mutation gates fail closed', async () => {
  const calls: string[][] = [];
  const invoke = async (args: string[]) => { calls.push(args); return {}; };
  const backend = new VirtualDisplayBackend(host, 'fixed-package', invoke);
  assert.throws(() => backend.install({ width: 1920, height: 1080 }));
  assert.throws(() => new VirtualDisplayBackend({ ...host, platform: 'linux' }, '', invoke).install({ confirm: true, width: 1, height: 1 }));
  assert.throws(() => new VirtualDisplayBackend({ ...host, server: true }, '', invoke).install({ confirm: true, width: 1, height: 1 }));
  assert.throws(() => backend.remove('../../other', true));
  assert.equal(calls.length, 0);
  await backend.install({ confirm: true, width: 2560, height: 1440 });
  assert.deepEqual(calls, [['install', 'fixed-package', '2560', '1440']]);
  assert.equal(backend.plan().hardwareVerified, false);
});
test('virtual display operations serialize and never retry unknown outcomes', async () => {
  let release!: () => void;
  let calls = 0;
  const backend = new VirtualDisplayBackend(host, 'fixed', async () => { calls++; await new Promise<void>(resolve => { release = resolve; }); throw new Error('unknown'); });
  const pending = backend.install({ confirm: true, width: 1920, height: 1080 });
  await assert.rejects(backend.remove('a'.repeat(32), true), /正在执行/);
  release();
  await assert.rejects(pending, /unknown/);
  assert.equal(calls, 1);
});
