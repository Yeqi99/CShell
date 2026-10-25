import test from 'node:test';
import assert from 'node:assert/strict';
import { Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { SshService } from '../src/core/ssh';
import { fixture } from './fixture';

test('real SSH transport disables Nagle before authentication and preserves interactive input', { timeout: 15000 }, async (t) => {
  const server = await fixture();
  let output = '';
  const service = new SshService((event) => {
    if (event.type === 'data') output += event.data;
  }, async () => true);
  const calls: { socket: Socket; enabled: boolean | undefined; authenticated: number }[] = [];
  const original = Socket.prototype.setNoDelay;
  t.mock.method(Socket.prototype, 'setNoDelay', function(this: Socket, enabled?: boolean) {
    // Only observe the real client socket; never inspect authentication payloads.
    if (this.remotePort === server.port) calls.push({ socket: this, enabled, authenticated: server.authenticationRequests() });
    return original.call(this, enabled);
  });
  try {
    const { sessionId } = await service.connect({
      id: randomUUID(), name: 'Transport fixture', host: '127.0.0.1', port: server.port,
      username: 'tester', auth: 'password', group: '', favorite: false,
    }, { password: server.password });
    const socket = (service.get(sessionId).client as unknown as { _sock: Socket })._sock;
    assert.ok(calls.some((call) => call.socket === socket && call.enabled === true && call.authenticated === 0));
    assert.equal(calls.filter((call) => call.socket === socket).at(-1)?.enabled, true);
    const input = 'echo transport-check\r';
    for (const character of input) service.input(sessionId, character);
    for (let i = 0; i < 300 && (!output.includes(input) || server.shellInputs.join('') !== input); i++) await delay(10);
    assert.equal(server.shellInputs.join(''), input);
    assert.ok(output.includes(input));
    assert.equal(server.connectionsCount(), 1);
  } finally {
    service.dispose();
    await server.close();
    t.mock.restoreAll();
  }
});

