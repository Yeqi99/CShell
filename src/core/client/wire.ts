import type { TLSSocket } from 'node:tls';
/** Bounded newline JSON frames. Terminal bytes are JSON strings, not parsed commands. */
export function frames(socket: TLSSocket, receive: (value: unknown) => void) {
  let buffer = Buffer.alloc(0);
  socket.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const end = buffer.indexOf(10);
      if (end < 0) break;
      if (end > 131072) {
        socket.destroy();
        return;
      }
      const frame = buffer.subarray(0, end);
      buffer = buffer.subarray(end + 1);
      try {
        receive(JSON.parse(frame.toString('utf8')));
      } catch {
        socket.destroy();
        return;
      }
    }
    if (buffer.length > 131072) socket.destroy();
  });
}
export function send(socket: TLSSocket, value: unknown) {
  if (socket.destroyed) throw new Error('Client connection closed');
  if (socket.writableLength > 2097152) {
    socket.destroy();
    throw new Error('Client output backlog exceeded');
  }
  socket.write(JSON.stringify(value) + '\n');
}
/** Avoid splitting UTF-16 surrogate pairs across terminal frames. */
export function* textChunks(text: string) {
  for (let offset = 0; offset < text.length;) {
    let end = Math.min(offset + 16384, text.length);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    yield text.slice(offset, end);
    offset = end;
  }
}
