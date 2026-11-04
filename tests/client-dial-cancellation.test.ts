import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Socket } from 'node:net';
import { createServer as createTlsServer } from 'node:tls';
import { getEventListeners } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createIdentity } from '../src/core/client/identity';
import { dial } from '../src/core/client/provider';

const identity = createIdentity();

test('already cancelled dial creates no connection', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(dial({ host: '127.0.0.1', port: 1 }, await identity, () => {}, controller.signal), { name: 'AbortError' });
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('real stalled TLS handshake times out and a later abort is harmless', async () => {
  const peers = new Set<Socket>();
  const server = createServer(socket => peers.add(socket));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const controller = new AbortController();
  try {
    await assert.rejects(dial({ host: '127.0.0.1', port: (server.address() as any).port }, await identity, () => {}, controller.signal), /connection timeout/);
    controller.abort();
    await delay(20);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  } finally {
    for (const peer of peers) peer.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('real stalled TLS dial cancels promptly and releases abort listeners', async () => {
  const peers = new Set<Socket>();
  const controller = new AbortController();
  const server = createServer(socket => { peers.add(socket); controller.abort(); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await assert.rejects(dial({ host: '127.0.0.1', port: (server.address() as any).port }, await identity, () => {}, controller.signal), /cancelled/);
    await delay(20);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  } finally {
    for (const peer of peers) peer.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('late abort following a real TLS protocol error cannot emit an unhandled cancellation error', async () => {
  const peers = new Set<Socket>();
  const server = createServer(socket => { peers.add(socket); socket.write('HTTP/1.1 400 Bad Request\r\n\r\n'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    for (let i = 0; i < 10; i++) {
      const controller = new AbortController();
      await assert.rejects(dial({ host: '127.0.0.1', port: (server.address() as any).port }, await identity, () => {}, controller.signal));
      controller.abort();
      await delay(5);
      assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    }
  } finally {
    for (const peer of peers) peer.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('authenticated TLS channel remains cancellable after handshake and has no handshake listeners', async () => {
  const credentials = await identity;
  const peers = new Set<Socket>();
  const server = createTlsServer({ key: credentials.key, cert: credentials.certificate }, socket => peers.add(socket));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const controller = new AbortController();
    const channel = await dial({ host: '127.0.0.1', port: (server.address() as any).port }, credentials, () => {}, controller.signal);
    assert.equal(channel.socket.listenerCount('secureConnect'), 0);
    assert.equal(channel.socket.listenerCount('error'), 1);
    controller.abort();
    await delay(20);
    assert.equal(channel.socket.destroyed, true);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  } finally {
    for (const peer of peers) peer.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
