import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractConnectionByRules as extract,
  ConnectionRuleError,
} from '../src/shared/connection-rules';

test('local rules recognize Chinese/English labelled details without inventing missing fields', () => {
  assert.deepEqual(
    extract(
      '主机地址：example.test  端口：2222  用户名：deploy\n密码：p@ss;word$!\n名称：开发服务器',
    ).fields,
    {
      host: 'example.test',
      port: 2222,
      username: 'deploy',
      password: 'p@ss;word$!',
      name: '开发服务器',
    },
  );
  assert.deepEqual(extract('Host=example.test, Port=22, User=dev').fields, {
    host: 'example.test',
    port: 22,
    username: 'dev',
  });
  assert.deepEqual(extract('IP地址: 192.0.2.10').fields, { host: '192.0.2.10' });
  assert.deepEqual(extract('备注：连接信息如下\n服务器地址: [2001:db8::1]:2222').fields, {
    host: '2001:db8::1',
    port: 2222,
  });
});
test('local rules handle SSH commands, URI and explicit destinations', () => {
  assert.deepEqual(extract('ssh -p2222 -l dev example.test').fields, {
    host: 'example.test',
    username: 'dev',
    port: 2222,
  });
  assert.deepEqual(extract('ssh://dev@[::1]:2222').fields, {
    host: '::1',
    username: 'dev',
    port: 2222,
  });
  assert.deepEqual(extract('dev@example.test:22').fields, {
    host: 'example.test',
    username: 'dev',
    port: 22,
  });
});
test('local rules refuse conflicts, unsupported commands and invalid ports atomically', () => {
  for (const text of [
    '主机: one.test\n主机: two.test',
    'ssh one.test\nssh two.test',
    'host: x.test\nport: 22\nport: 23',
  ])
    assert.throws(
      () => extract(text),
      (e) => e instanceof ConnectionRuleError && e.reason === 'ambiguous',
    );
  for (const text of [
    'ssh host -J jump',
    'ssh host; reboot',
    'host: x.test port: 0',
    'host: x.test port: 65536',
    'https://example.test',
    '请连接到服务器',
    'x'.repeat(24001),
  ])
    assert.throws(() => extract(text), ConnectionRuleError);
});
