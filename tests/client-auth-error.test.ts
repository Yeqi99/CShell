import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientAuthError } from '../src/core/client/auth-error';
test('authentication diagnostics distinguish missing pairing, password rejection and retry limits', () => {
 assert.match(clientAuthError(new Error('Invalid invitation')), /配对已失效/);
 assert.match(clientAuthError(new Error('Invalid password')), /密码认证失败/);
 assert.match(clientAuthError(new Error('Authentication rate limited')), /一分钟/);
 assert.match(clientAuthError(new Error('Peer limit')), /上限/);
});
test('unexpected persistence errors never accuse password or expose private error content', () => {
 const result=clientAuthError(new Error('EACCES private/path secret-value'));
 assert.match(result,/保存配对/);
 assert.doesNotMatch(result,/private|secret|密码不正确/);
});
