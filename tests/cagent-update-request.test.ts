import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Socket } from 'node:net';
import { updateRequest } from '../src/agent/update-request';

test('aborting update request closes a stalled TLS handshake socket', async () => {
  const sockets = new Set<Socket>();
  let accept!: () => void;
  const accepted = new Promise<void>(resolve => { accept = resolve; });
  const server = createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {}); socket.resume(); accept();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 3000);
  try {
    const port = (server.address() as { port: number }).port;
    const pending = updateRequest(`https://127.0.0.1:${port}/updates`, { signal: abort.signal });
    const rejected = assert.rejects(pending, { name: 'AbortError' });
    await accepted;
    abort.abort(); await rejected;
    for (let i = 0; i < 100 && sockets.size; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(sockets.size, 0, 'owned connecting socket must actually close');
  } finally {
    clearTimeout(timeout); abort.abort();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
