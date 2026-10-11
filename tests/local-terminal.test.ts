import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeEnvironment } from '../src/core/connections/local-terminal-provider';
import { localEnvironmentSchema, localShellSchema } from '../src/shared/local-terminal';
test('Windows environment overrides are case-insensitive, preserve empty values, and leave the parent untouched', () => {
  const base = { Path: 'system;user', TEMP: 'original' };
  const env = mergeEnvironment(base, [
    { name: 'PATH', value: 'custom' },
    { name: 'Temp', value: '' },
    { name: 'UNICODE', value: '中文' },
  ]);
  assert.deepEqual(env, { PATH: 'custom', TEMP: '', UNICODE: '中文' });
  assert.equal(base.Path, 'system;user');
  assert.throws(() =>
    localEnvironmentSchema.parse([
      { name: 'Path', value: 'a' },
      { name: 'PATH', value: 'b' },
    ]),
  );
  assert.throws(() => localEnvironmentSchema.parse([{ name: 'BAD=NAME', value: 'a' }]));
  assert.throws(() => localEnvironmentSchema.parse([{ name: 'OK', value: 'bad\0value' }]));
  assert.equal(localShellSchema.parse('wsl:Ubuntu-24.04'), 'wsl:Ubuntu-24.04');
  assert.throws(() => localShellSchema.parse('cmd.exe /c anything'));
});
