import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connect, createServer } from 'node:net';
import { once } from 'node:events';
import { createSshBrowserProxy } from '../src/core/ssh-browser-proxy';
test('SOCKS hostname is passed unchanged to SSH, pipes bytes, and disconnect closes active sockets', async () => {
  const echo = createServer((s) => s.pipe(s));
  await new Promise<void>((r) => echo.listen(0, '127.0.0.1', r));
  const seen: any[] = [];
  const proxy = await createSshBrowserProxy((host, port, done) => {
    seen.push([host, port]);
    const upstream = connect((echo.address() as any).port, '127.0.0.1', () => done(null, upstream));
  });
  const socket = connect(proxy.port, '127.0.0.1');
  socket.on('error', () => {});
  await once(socket, 'connect');
  let next = once(socket, 'data');
  socket.write(Buffer.from([5]));
  socket.write(Buffer.from([1, 0]));
  assert.deepEqual((await next)[0], Buffer.from([5, 0]));
  next = once(socket, 'data');
  const host = Buffer.from('only-on-remote.invalid');
  socket.write(
    Buffer.concat([Buffer.from([5, 1, 0, 3, host.length]), host, Buffer.from([1, 187])]),
  );
  assert.equal((await next)[0][1], 0);
  assert.deepEqual(seen, [['only-on-remote.invalid', 443]]);
  next = once(socket, 'data');
  socket.write('test payload');
  assert.equal((await next)[0].toString(), 'test payload');
  const closed = once(socket, 'close');
  proxy.close();
  await closed;
  await new Promise<void>((r) => echo.close(() => r()));
});
test('SOCKS rejects UDP and connection failure without any direct fallback', async () => {
  let calls = 0;
  const proxy = await createSshBrowserProxy((_h, _p, done) => {
    calls++;
    done(Error('SSH closed'));
  });
  for (const command of [3, 1]) {
    const socket = connect(proxy.port, '127.0.0.1');
    socket.on('error', () => {});
    await once(socket, 'connect');
    let next = once(socket, 'data');
    socket.write(Buffer.from([5, 1, 0]));
    await next;
    next = once(socket, 'data');
    socket.write(Buffer.from([5, command, 0, 1, 127, 0, 0, 1, 0, 80]));
    assert.notEqual((await next)[0][1], 0);
    socket.destroy();
  }
  assert.equal(calls, 1);
  proxy.close();
});
