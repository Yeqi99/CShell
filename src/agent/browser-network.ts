import { connect, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
type Channel = {
  owner: string;
  socket: Socket;
  data: Buffer;
  ended: boolean;
  error?: string;
  wait?: () => void;
  reading: boolean;
  sequence: number;
};
/** Authenticated RPC tunnel. No listening port on the agent; bounded per-owner buffers. */
export class AgentBrowserNetwork {
  private channels = new Map<string, Channel>();
  constructor(private allowed: (owner: string) => boolean) {}
  private guard(owner: string) {
    if (!this.allowed(owner)) {
      for (const [id, c] of this.channels)
        if (c.owner === owner) {
          c.socket.destroy();
          c.wait?.();
          this.channels.delete(id);
        }
      throw Error('浏览器网络访问未授权');
    }
  }
  async call(method: string, raw: unknown, owner: string) {
    this.guard(owner);
    if (method === 'browser.status') return { available: true, platform: process.platform };
    if (method === 'browser.open') {
      const p = z
        .object({
          host: z
            .string()
            .min(1)
            .max(253)
            .regex(/^[a-zA-Z0-9._:\-]+$/),
          port: z.number().int().min(1).max(65535),
        })
        .strict()
        .parse(raw);
      if (
        [...this.channels.values()].filter((c) => c.owner === owner).length >= 64 ||
        this.channels.size >= 128
      )
        throw Error('浏览器连接数已达上限');
      const id = randomUUID(),
        socket = connect({ host: p.host, port: p.port }),
        c: Channel = {
          owner,
          socket,
          data: Buffer.alloc(0),
          ended: false,
          reading: false,
          sequence: 0,
        };
      this.channels.set(id, c);
      socket.on('data', (data) => {
        try {
          this.guard(owner);
        } catch {
          socket.destroy();
          return;
        }
        c.data = Buffer.concat([c.data, Buffer.from(data)]);
        if (c.data.length >= 256 * 1024) socket.pause();
        c.wait?.();
      });
      socket.on('end', () => {
        c.ended = true;
        c.wait?.();
      });
      socket.on('close', () => {
        c.ended = true;
        c.wait?.();
      });
      socket.on('error', (e) => {
        c.error = e.message;
        c.ended = true;
        c.wait?.();
      });
      socket.setTimeout(60000, () => {
        c.error = '连接空闲超时';
        socket.destroy();
        this.channels.delete(id);
      });
      try {
        await new Promise<void>((done, reject) => {
          const timer = setTimeout(() => {
            socket.destroy();
            reject(Error('服务器连接超时'));
          }, 15000);
          socket.once('connect', () => {
            clearTimeout(timer);
            done();
          });
          socket.once('error', (e) => {
            clearTimeout(timer);
            reject(e);
          });
        });
        this.guard(owner);
        return { id };
      } catch (e) {
        this.channels.delete(id);
        socket.destroy();
        throw e;
      }
    }
    const p = z
        .object({
          id: z.string().uuid(),
          data: z
            .string()
            .max(87384)
            .regex(/^[A-Za-z0-9+/]*={0,2}$/)
            .optional(),
          sequence: z.number().int().min(0).optional(),
        })
        .strict()
        .parse(raw),
      c = this.channels.get(p.id);
    if (!c || c.owner !== owner) throw Error('浏览器连接已关闭');
    if (method === 'browser.close') {
      c.socket.destroy();
      this.channels.delete(p.id);
      c.wait?.();
      return {};
    }
    if (method === 'browser.write') {
      if (p.sequence !== c.sequence || p.data === undefined) throw Error('浏览器写入顺序无效');
      c.sequence++;
      await new Promise<void>((done, reject) =>
        c.socket.write(Buffer.from(p.data!, 'base64'), (e) => (e ? reject(e) : done())),
      );
      return { sequence: c.sequence };
    }
    if (method === 'browser.read') {
      if (c.reading) throw Error('重复读取');
      c.reading = true;
      try {
        if (!c.data.length && !c.ended)
          await new Promise<void>((done) => {
            const timer = setTimeout(() => {
              c.wait = undefined;
              done();
            }, 15000);
            c.wait = () => {
              clearTimeout(timer);
              c.wait = undefined;
              done();
            };
          });
        this.guard(owner);
        const data = c.data.subarray(0, 65536);
        c.data = c.data.subarray(data.length);
        if (c.data.length < 128 * 1024) c.socket.resume();
        return { data: data.toString('base64'), ended: c.ended && !c.data.length, error: c.error };
      } finally {
        c.reading = false;
      }
    }
    throw Error('未知浏览器操作');
  }
  close() {
    for (const c of this.channels.values()) {
      c.socket.destroy();
      c.wait?.();
    }
    this.channels.clear();
  }
}
