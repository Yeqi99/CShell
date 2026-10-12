import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WslSetup, wslSetupScript, wslFailureMessage } from '../src/desktop/wsl-setup';

test('WSL network failures explain recovery without claiming the runtime is missing', () => {
  assert.match(
    wslFailureMessage(-1, 'Wsl/InstallDistro/WININET_E_CANNOT_CONNECT'),
    /系统代理与网络/,
  );
  assert.match(wslFailureMessage(-1, 'WININET_E_NAME_NOT_RESOLVED'), /下载服务/);
  assert.match(wslFailureMessage(5, 'Access denied'), /退出码 5/);
});
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
import { decodeWslOutput, wslInstallArguments } from '../src/desktop/wsl-setup';
test('WSL bootstrap uses only supported flags and decodes native diagnostics', () => {
  assert.deepEqual(wslInstallArguments('--install --update --help', true), ['--install']);
  assert.throws(() => wslInstallArguments('--install --update --help', false), /引导程序/);
  assert.deepEqual(wslInstallArguments('--install --no-launch', true), [
    '--install',
    '--distribution',
    'Ubuntu',
    '--no-launch',
  ]);
  assert.equal(decodeWslOutput(Buffer.from('需要重启\r\r\n', 'utf16le')), '需要重启');
});
