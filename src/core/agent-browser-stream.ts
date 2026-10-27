import { Duplex } from 'node:stream';
export type BrowserAgentCall = (method: string, params?: unknown) => Promise<any>;
export async function agentBrowserStream(call: BrowserAgentCall, host: string, port: number) {
  const { id } = await call('browser.open', { host, port });
  let sequence = 0,
    reading = false;
  const stream = new Duplex({
    read() {
      if (reading) return;
      reading = true;
      void (async () => {
        try {
          while (!stream.destroyed) {
            const r = await call('browser.read', { id });
            if (stream.destroyed) break;
            if (r.error) throw Error(r.error);
            const ok = !r.data || stream.push(Buffer.from(r.data, 'base64'));
            if (r.ended) {
              stream.push(null);
              break;
            }
            if (!ok) break;
          }
        } catch (e) {
          stream.destroy(e as Error);
        } finally {
          reading = false;
        }
      })();
    },
    write(chunk: Buffer, _enc, done) {
      void (async () => {
        for (let offset = 0; offset < chunk.length; offset += 65536) {
          if (stream.destroyed) throw Error('浏览器连接已关闭');
          await call('browser.write', {
            id,
            sequence,
            data: chunk.subarray(offset, offset + 65536).toString('base64'),
          });
          if (stream.destroyed) throw Error('浏览器连接已关闭');
          sequence++;
        }
      })().then(() => done(), done);
    },
    destroy(error, done) {
      void call('browser.close', { id }).catch(() => {});
      done(error);
    },
  });
  return stream;
}
