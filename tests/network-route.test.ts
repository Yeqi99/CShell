import { test } from 'node:test';
import assert from 'node:assert/strict';
import { networkRouteSchema } from '../src/shared/network-route';
test('network route accepts one explicit endpoint and rejects bypass or credential injection', () => {
  assert.deepEqual(networkRouteSchema.parse({ mode: 'proxy', url: 'http://localhost:7890/' }), { mode: 'proxy', url: 'http://localhost:7890' });
  assert.equal(networkRouteSchema.parse({ mode: 'proxy', url: 'http://localhost:80' }).mode, 'proxy');
  for (const url of ['http://user:secret@localhost:80', 'http://localhost:80/path', 'http://localhost:80?bypass=*', 'socks5://localhost', 'http://localhost:80;direct://', 'file:///x']) {
    assert.throws(() => networkRouteSchema.parse({ mode: 'proxy', url }));
  }
  assert.throws(() => networkRouteSchema.parse({ mode: 'direct', proxy: '*' }));
});
