import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSshCommand } from '../src/shared/ssh-command';

test('SSH quick input parses destinations and rejects commands it cannot represent', () => {
  assert.deepEqual(parseSshCommand('ssh root@192.168.1.100 -p 2222'), {
    host: '192.168.1.100',
    username: 'root',
    port: 2222,
  });
  assert.deepEqual(parseSshCommand('ssh -p2222 -l deploy example.com'), {
    host: 'example.com',
    username: 'deploy',
    port: 2222,
  });
  assert.deepEqual(parseSshCommand('ssh user@[::1]'), { host: '::1', username: 'user', port: 22 });
  assert.equal(parseSshCommand('example.com'), null);
  for (const input of [
    'ssh host; echo x',
    'ssh host && whoami',
    'ssh host reboot',
    'ssh -J jump host',
    'ssh -i key host',
    'ssh host -p 65536',
    'ssh host -p 0',
    'ssh @host',
    'ssh -p',
    'ssh host\nwhoami',
  ])
    assert.throws(() => parseSshCommand(input));
});
