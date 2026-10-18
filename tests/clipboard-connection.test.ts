import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clipboardDigest,
  detectClipboardConnection as detect,
} from '../src/shared/clipboard-connection';

test('clipboard detection requires explicit connection information', () => {
  for (const text of [
    'example.com',
    'user@example.com',
    'https://example.com',
    'host: example.com',
    '说明文字\nexample.com',
    'ssh a.test; rm -rf /',
    'ssh a.test\nssh b.test',
    '主机: a.test 端口: 99999',
    'ssh ' + 'x'.repeat(24000),
  ])
    assert.equal(detect(text), null, text);
  assert.equal(detect('ssh -p 2222 dev@example.test')?.fields.port, 2222);
  assert.equal(detect('ssh://dev@[::1]:2222')?.fields.host, '::1');
  assert.deepEqual(detect('主机: example.test 端口: 22 用户名: dev\n密码: secret')?.fields, {
    host: 'example.test',
    port: 22,
    username: 'dev',
    password: 'secret',
  });
});

test('deduplication uses a stable digest without storing clipboard text', async () => {
  const a = await clipboardDigest('ssh dev@example.test');
  assert.match(a, /^[a-f0-9]{64}$/);
  assert.equal(a, await clipboardDigest('  ssh dev@example.test\n'));
  assert.notEqual(a, await clipboardDigest('ssh other@example.test'));
});
