import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WslSetup, wslSetupScript } from '../src/desktop/wsl-setup';
test('WSL setup uses fixed elevated commands and keeps installation lifecycle', async () => {
  assert.match(wslSetupScript(true), /Ubuntu/);
  assert.match(wslSetupScript(false), /--no-distribution/);
  assert.match(wslSetupScript(true), /-Verb RunAs/);
  assert.doesNotMatch(wslSetupScript(true), /Restart-Computer/);
  let resolve!: (code: number) => void;
  let count = 0;
  const setup = new WslSetup(() => {
    count++;
    return new Promise((r) => {
      resolve = r;
    });
  });
  assert.equal(setup.start(true).phase, 'running');
  setup.start(false);
  assert.equal(count, 1);
  resolve(3010);
  await new Promise((r) => setImmediate(r));
  assert.equal(setup.snapshot().phase, 'complete');
  assert.match(setup.snapshot().message!, /重启/);
  const denied = new WslSetup(async () => {
    throw new Error('UAC canceled');
  });
  denied.start(true);
  await new Promise((r) => setImmediate(r));
  assert.equal(denied.snapshot().phase, 'error');
  const failed = new WslSetup(async () => 5);
  failed.start(false);
  await new Promise((r) => setImmediate(r));
  assert.equal(failed.snapshot().phase, 'error');
});
