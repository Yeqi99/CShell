import { createServer, type Socket } from 'node:net';
import type { Duplex } from 'node:stream';
export type Forward = (
  host: string,
  port: number,
  done: (error: Error | null, stream?: Duplex) => void,
) => void;
// Loopback-only, connection-scoped SOCKS5 CONNECT. Hostnames are resolved by SSH's target.
export async function createSshBrowserProxy(forward: Forward) {
  const sockets = new Set<Socket | Duplex>();
  let closed = false;
  const server = createServer((socket) => {
    if (closed || sockets.size >= 256) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    let buffer = Buffer.alloc(0),
      stage = 0;
    socket.setTimeout(15000, () => socket.destroy());
    const fail = () => {
      socket.end(Buffer.from([5, 1, 0, 1, 0, 0, 0, 0, 0, 0]));
    };
    const read = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > 65536) {
        socket.destroy();
        return;
      }
      if (stage === 0) {
        if (buffer.length < 2) return;
        const n = buffer[1];
        if (buffer.length < 2 + n) return;
        if (buffer[0] !== 5 || !buffer.subarray(2, 2 + n).includes(0)) {
          socket.end(Buffer.from([5, 255]));
          return;
        }
        buffer = buffer.subarray(2 + n);
        stage = 1;
        socket.write(Buffer.from([5, 0]));
      }
      if (stage !== 1 || buffer.length < 5) return;
      if (buffer[0] !== 5 || buffer[1] !== 1 || buffer[2] !== 0) {
        fail();
        return;
      }
      let host = '',
        end = 0;
      if (buffer[3] === 3) {
        end = 5 + buffer[4];
        if (buffer.length < end + 2) return;
        host = buffer.subarray(5, end).toString('utf8');
      } else if (buffer[3] === 1) {
        end = 8;
        if (buffer.length < 10) return;
        host = [...buffer.subarray(4, 8)].join('.');
      } else if (buffer[3] === 4) {
        end = 20;
        if (buffer.length < 22) return;
        host = Array.from({ length: 8 }, (_, i) =>
          buffer.readUInt16BE(4 + i * 2).toString(16),
        ).join(':');
      } else {
        fail();
        return;
      }
      const port = buffer.readUInt16BE(end);
      if (!host || !port || /[\0\r\n]/.test(host)) {
        fail();
        return;
      }
      stage = 2;
      socket.pause();
      socket.removeListener('data', read);
      const tail = buffer.subarray(end + 2);
      forward(host, port, (error, stream) => {
        if (error || !stream) {
          fail();
          return;
        }
        if (closed || socket.destroyed) {
          stream.destroy();
          return;
        }
        sockets.add(stream);
        stream.once('close', () => {
          sockets.delete(stream);
          socket.destroy();
        });
        stream.on('error', () => socket.destroy());
        socket.once('close', () => stream.destroy());
        socket.setTimeout(0);
        socket.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
        if (tail.length) stream.write(tail);
        socket.pipe(stream).pipe(socket);
        socket.resume();
      });
    };
    socket.on('data', read);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    port: (server.address() as { port: number }).port,
    close() {
      closed = true;
      for (const s of sockets) s.destroy();
      sockets.clear();
      server.close();
    },
  };
}
