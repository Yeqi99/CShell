import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classroomProxyAction, classroomProxyKeys } from '../src/shared/classroom-proxy';
import { ManagedEnvironment } from '../src/agent/managed-classroom';
import type { ClientVault } from '../src/core/client/identity';
test('proxy action sets only matching upper/lower process variables with explicit bypass', () => {
  const action = classroomProxyAction({ mode: 'set', url: 'http://192.168.10.2:7890/', noProxy: 'localhost, .example.internal,localhost' });
  assert.equal(action.kind, 'environment');assert.deepEqual(Object.keys(action.variables).sort(), [...classroomProxyKeys].sort());
  assert.equal(action.variables.HTTP_PROXY, 'http://192.168.10.2:7890');assert.equal(action.variables.https_proxy, action.variables.HTTP_PROXY);
  assert.equal(action.variables.NO_PROXY, 'localhost,.example.internal');
  assert.equal(classroomProxyAction({ mode: 'set', url: 'https://[::1]:8443', noProxy: '' }).variables.no_proxy, '');
  assert.equal(classroomProxyAction({ mode: 'set', url: 'http://proxy:8080', noProxy: 'example.com:80' }).variables.NO_PROXY, 'example.com:80');
});
test('invalid URL, embedded secret, control characters and blanket bypass are rejected without echoing input', () => {
  for (const url of ['192.168.1.2:7890', 'socks5://proxy:1080', 'http://user:private-secret@proxy:8080', 'http://proxy:99999', 'http://proxy/path', 'http://proxy?secret=private-secret', 'http://proxy/#private-secret', 'http://proxy\n', 'http:\\proxy']) {
    assert.throws(() => classroomProxyAction({ mode: 'set', url, noProxy: '' }), error => error instanceof Error && !error.message.includes('private-secret'));
  }
  for (const noProxy of ['*', 'https://example.com', 'host,,other', 'host\nOTHER=1', 'a@host']) assert.throws(() => classroomProxyAction({ mode: 'set', url: 'http://proxy:8080', noProxy }));
});
test('apply/clear preserves unrelated variables and does not manufacture a direct-connect fallback', async () => {
  let saved: Record<string, string> = { KEEP_ME: 'unchanged', ANOTHER: 'unchanged-too' }, effective: Record<string, string> = {};
  const vault = { read: async () => saved, write: async (_name: string, value: Record<string, string>) => { saved = { ...value }; } } as unknown as ClientVault;
  const environment = new ManagedEnvironment(vault, values => { effective = values; });await environment.load();
  const set = classroomProxyAction({ mode: 'set', url: 'http://proxy.invalid:7890', noProxy: '' });await environment.save({ variables: set.variables });
  assert.equal(effective.KEEP_ME, 'unchanged');assert.equal(effective.HTTPS_PROXY ?? effective.https_proxy, 'http://proxy.invalid:7890');
  assert(!Object.keys(effective).some(key => /fallback|direct/i.test(key)));
  const clear = classroomProxyAction({ mode: 'clear', url: '', noProxy: '' });assert(Object.values(clear.variables).every(v => v === null));await environment.save({ variables: clear.variables });
  assert.deepEqual(effective, { KEEP_ME: 'unchanged', ANOTHER: 'unchanged-too' });
});
