import { createServer, request, type Server } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { agentDirectory, privateDirectory, protectPath } from './storage';

const discoverySchema = z
  .object({
    version: z.literal(1),
    port: z.number().int().min(1).max(65535),
    token: z.string().regex(/^[a-f0-9]{64}$/),
    pid: z.number().int().positive(),
  })
  .strict();
export type AgentDiscovery = z.infer<typeof discoverySchema>;
export async function discoverAgent(
  directory = agentDirectory(),
): Promise<AgentDiscovery | undefined> {
  try {
    return discoverySchema.parse(
      JSON.parse(await readFile(join(directory, 'discovery.json'), 'utf8')),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}
export async function callAgent(
  method: string,
  params?: unknown,
  directory = agentDirectory(),
  signal?: AbortSignal,
): Promise<any> {
  const endpoint = await discoverAgent(directory);
  if (!endpoint) throw new Error('本机 Agent 未运行');
  return callDiscoveredAgent(endpoint, method, params, signal);
}
export async function callDiscoveredAgent(
  endpoint: AgentDiscovery,
  method: string,
  params?: unknown,
  signal?: AbortSignal,
): Promise<any> {
  const body = JSON.stringify({ method, params });
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: '127.0.0.1',
        port: endpoint.port,
        path: '/control',
        method: 'POST',
        signal,
        headers: {
          Authorization: 'Bearer ' + endpoint.token,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (response) => {
        let text = '';
        response.on('data', (chunk) => {
          text += chunk;
          if (Buffer.byteLength(text) > 2097152) req.destroy(new Error('Agent 响应过大'));
        });
        response.on('end', () => {
          try {
            const value = JSON.parse(text);
            if (response.statusCode !== 200 || value.error)
              throw new Error(value.error || 'Agent 请求失败');
            resolve(value.result);
          } catch (error) {
            reject(error);
          }
        });
        response.on('error', reject);
      },
    );
    req.setTimeout(method.startsWith('wsl.') ? 120000 : 60000, () =>
      req.destroy(new Error('本机 Agent 响应超时')),
    );
    req.on('error', reject);
    req.end(body);
  });
}
export async function startAgentControl(
  directory: string,
  dispatch: (method: string, params: unknown, signal: AbortSignal) => Promise<unknown>,
) {
  await privateDirectory(directory);
  const discoveryPath = join(directory, 'discovery.json');
  const existing = await discoverAgent(directory);
  if (existing) {
    let alive = false;
    try {
      await callDiscoveredAgent(existing, 'client.status');
      alive = true;
    } catch (error) {
      if (!['ECONNREFUSED', 'ECONNRESET'].includes((error as NodeJS.ErrnoException).code || ''))
        throw new Error('现有 Agent 状态不明，请先恢复或停止原进程');
    }
    if (alive) throw new Error('本机 Agent 已运行');
    await unlink(discoveryPath);
  }
  const token = randomBytes(32).toString('hex');
  const server: Server = createServer((req, res) => {
    const supplied = req.headers.authorization?.replace(/^Bearer /, '') || '';
    if (
      req.method !== 'POST' ||
      req.url !== '/control' ||
      req.headers.origin ||
      !/^[a-f0-9]{64}$/.test(supplied) ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))
    ) {
      res.writeHead(403, { Connection: 'close' });
      res.end();
      return;
    }
    const abort = new AbortController();
    req.on('aborted', () => abort.abort());
    res.on('close', () => {
      if (!res.writableEnded) abort.abort();
    });
    let text = '';
    req.on('data', (chunk) => {
      text += chunk;
      if (Buffer.byteLength(text) > 1048576) {
        abort.abort();
        req.destroy();
      }
    });
    req.on('end', async () => {
      try {
        const input = z
          .object({ method: z.string().min(1).max(80), params: z.unknown().optional() })
          .strict()
          .parse(JSON.parse(text));
        const result = await dispatch(input.method, input.params, abort.signal);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ result }));
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: error instanceof Error ? error.message : 'Agent 请求失败' }),
        );
      }
    });
  });
  server.maxConnections = 8;
  server.requestTimeout = 30000;
  server.headersTimeout = 5000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Agent 控制端口错误');
  try {
    await writeFile(
      discoveryPath,
      JSON.stringify({ version: 1, port: address.port, token, pid: process.pid }),
      { mode: 0o600, flag: 'wx' },
    );
    await protectPath(discoveryPath);
  } catch (error) {
    server.closeAllConnections();
    server.close();
    throw error;
  }
  return {
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      const current = await discoverAgent(directory);
      if (current?.token === token) await unlink(discoveryPath);
    },
  };
}
