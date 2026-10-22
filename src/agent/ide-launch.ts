import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';

const handoffs = new Map<string, Server>();

/** A short-lived, one-use handoff through the authenticated machine tunnel. */
export async function ideLaunch(url: string, password: string, allowed: () => boolean) {
  const destination = new URL(url);
  if (destination.hostname !== '127.0.0.1' || destination.protocol !== 'http:')
    throw Error('编辑器地址无效');
  const response = await fetch(new URL('/login', destination), {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password }), signal: AbortSignal.timeout(10000),
  });
  const cookies = response.headers.getSetCookie();
  if (response.status !== 302 || !cookies.length) throw Error('编辑器认证失败');
  handoffs.get(url)?.close();
  const token = '/' + randomBytes(32).toString('base64url');
  let used = false;
  const server = createServer((request, reply) => {
    reply.setHeader('Cache-Control', 'no-store');
    reply.setHeader('Referrer-Policy', 'no-referrer');
    if (used || request.method !== 'GET' || request.url !== token || !allowed()) {
      reply.writeHead(403).end();
      return;
    }
    used = true;
    reply.writeHead(302, { 'Set-Cookie': cookies, Location: url }).end();
    server.close();
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  handoffs.set(url, server);
  server.unref();
  const timer = setTimeout(() => server.close(), 60000);
  timer.unref();
  server.once('close', () => { clearTimeout(timer); if (handoffs.get(url) === server) handoffs.delete(url); });
  return `http://127.0.0.1:${(server.address() as { port: number }).port}${token}`;
}
