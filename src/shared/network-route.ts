import { z } from 'zod';

export const networkRouteSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('direct') }).strict(),
  z.object({ mode: z.literal('proxy'), url: z.string().max(2048).transform(value => {
    const url = new URL(value);
    if (!['http:', 'https:', 'socks5:'].includes(url.protocol) || !url.hostname || (url.protocol === 'socks5:' && !url.port) ||
        url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== '/'))
      throw new Error('请输入 HTTP、HTTPS 或 SOCKS5 代理地址与端口，不含路径或账号');
    return `${url.protocol}//${url.host}`;
  }) }).strict(),
  z.object({ mode: z.literal('machine'), id: z.string().uuid() }).strict(),
]);
export type NetworkRoute = z.infer<typeof networkRouteSchema>;
export type NetworkRouteStatus = { route: NetworkRoute; machines: { id: string; name: string }[] };
