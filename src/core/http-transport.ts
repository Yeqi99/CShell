import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { isIP } from 'node:net';
import type { Duplex } from 'node:stream';
import { httpWireSchema, type HttpWireRequest, type HttpResponse } from '../shared/http';

export type HttpTunnel = (host: string, port: number, signal: AbortSignal) => Promise<Duplex>;
/** Redirects are returned to the caller, never followed across target/credential boundaries. */
export async function executeHttp(
  value: HttpWireRequest,
  parent: AbortSignal,
  tunnel?: HttpTunnel,
  limit = 1024 * 1024,
): Promise<HttpResponse> {
  const input = httpWireSchema.parse(value),
    url = new URL(input.url);
  const signal = AbortSignal.any([parent, AbortSignal.timeout(input.timeoutMs)]);
  signal.throwIfAborted();
  const started = Date.now();
  const headers: Record<string, string> = { 'accept-encoding': 'identity' };
  for (const row of input.headers.filter((r) => r.enabled && r.name)) {
    http.validateHeaderName(row.name);
    http.validateHeaderValue(row.name, row.value);
    if (
      /^(host|content-length|transfer-encoding|connection|upgrade|proxy-authorization|proxy-connection)$/i.test(
        row.name,
      )
    )
      throw new Error('请求头由传输层管理：' + row.name);
    headers[row.name.toLowerCase()] = row.value;
  }
  if (['GET', 'HEAD'].includes(input.method) && input.body)
    throw new Error('GET / HEAD 不发送请求体');
  headers['content-length'] = String(Buffer.byteLength(input.body));
  const secure = url.protocol === 'https:';
  const agent = secure
    ? new https.Agent({ keepAlive: false })
    : new http.Agent({ keepAlive: false });
  let socket: Duplex | undefined;
  try {
    if (tunnel) {
      const host = url.hostname.replace(/^\[|\]$/g, '');
      socket = await tunnel(host, Number(url.port || (secure ? 443 : 80)), signal);
      signal.throwIfAborted();
      if (secure)
        socket = tls.connect({
          socket: socket as import('node:net').Socket,
          servername: isIP(host) ? undefined : host,
          rejectUnauthorized: true,
          checkServerIdentity: (_name, cert) => tls.checkServerIdentity(host, cert),
        });
      const captured = socket;
      agent.createConnection = () => captured as import('node:net').Socket;
    }
    return await new Promise<HttpResponse>((resolve, reject) => {
      const req = (secure ? https : http).request(
        url,
        { method: input.method, headers, agent, signal },
        (res) => {
          const chunks: Buffer[] = [];
          let bytes = 0,
            truncated = false,
            complete = false;
          const finish = () => {
            if (complete) return;
            complete = true;
            const pairs: [string, string][] = [];
            for (let i = 0; i < res.rawHeaders.length; i += 2)
              pairs.push([res.rawHeaders[i], res.rawHeaders[i + 1]]);
            resolve({
              status: res.statusCode ?? 0,
              statusText: res.statusMessage ?? '',
              headers: pairs,
              body: Buffer.concat(chunks).toString('base64'),
              bytes,
              elapsedMs: Date.now() - started,
              truncated,
            });
          };
          res.on('data', (chunk: Buffer) => {
            const remaining = limit - bytes;
            if (chunk.length > remaining) {
              chunks.push(chunk.subarray(0, remaining));
              bytes = limit;
              truncated = true;
              finish();
              res.destroy();
            } else {
              chunks.push(chunk);
              bytes += chunk.length;
            }
          });
          res.once('end', finish);
          res.once('error', reject);
          res.once('aborted', () => {
            if (!complete) reject(new Error('响应在完成前断开'));
          });
        },
      );
      req.once('error', reject);
      req.end(input.body);
    });
  } finally {
    agent.destroy();
    socket?.destroy();
  }
}
