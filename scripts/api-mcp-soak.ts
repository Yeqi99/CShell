import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Store } from '../src/core/store';
import { McpService } from '../src/core/mcp';
const directory = await mkdtemp(join(tmpdir(), 'cshell-mcp-soak-'));
const store = new Store(directory, {
  encrypt: async (s) => Buffer.from(s).toString('base64'),
  decrypt: async (s) => Buffer.from(s, 'base64').toString(),
});
const service = new McpService(store, directory, async () => true);
const clients = Array.from(
  { length: 3 },
  (_, i) => new Client({ name: 'soak-' + i, version: '1' }),
);
const samples: unknown[] = [];
const timings = clients.map(() => [] as number[]);
const delay = monitorEventLoopDelay({ resolution: 20 });
let timer: ReturnType<typeof setInterval> | undefined;
try {
  await store.load();
  const probe = createServer();
  await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
  const port = (probe.address() as any).port;
  await new Promise<void>((r) => probe.close(() => r()));
  const owners = clients.map(() => randomUUID());
  await service.configure({
    enabled: true,
    port,
    allowedProfiles: [],
    allowCommands: false,
    clients: owners.map((id) => ({
      id,
      name: 'isolated-soak',
      enabled: true,
      allowedProfiles: [],
      allowCommands: false,
      capabilities: [],
      review: 'authorized',
      disclosure: { mode: 'progressive', level: 'summary', budgetBytes: 32768 },
    })),
  });
  const tokens = await Promise.all(owners.map((id) => service.accessToken(id)));
  await Promise.all(
    clients.map((c, i) =>
      c.connect(
        new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
          requestInit: { headers: { Authorization: `Bearer ${tokens[i]}` } },
        }),
      ),
    ),
  );
  const started = Date.now(),
    duration = Number(process.env.CSHELL_MCP_SOAK_MS || 600000);
  delay.enable();
  timer = setInterval(() => {
    samples.push({
      at: new Date().toISOString(),
      memory: process.memoryUsage(),
      resources: process.getActiveResourcesInfo(),
    });
    void writeFile(
      'test-results/api-mcp-soak-progress.json',
      JSON.stringify(
        {
          pid: process.pid,
          elapsedMs: Date.now() - started,
          counts: timings.map((t) => t.length),
          samples,
        },
        null,
        2,
      ),
    );
  }, 15000);
  console.log(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  await Promise.all(
    clients.map(async (c, i) => {
      while (Date.now() - started < duration) {
        const t = performance.now();
        const result = await c.callTool({
          name: 'invoke_capability',
          arguments: { name: 'list_servers', arguments: {} },
        });
        assert.ok(!result.isError, JSON.stringify(result));
        timings[i].push(performance.now() - t);
        await new Promise((r) => setTimeout(r, 100));
      }
    }),
  );
  await service.rotateToken(owners[0]);
  await assert.rejects(
    clients[0].callTool({
      name: 'invoke_capability',
      arguments: { name: 'list_servers', arguments: {} },
    }),
  );
  assert.ok(
    !(
      await clients[1].callTool({
        name: 'invoke_capability',
        arguments: { name: 'list_servers', arguments: {} },
      })
    ).isError,
  );
  delay.disable();
  const quantile = (v: number[], p: number) =>
    [...v].sort((a, b) => a - b)[Math.floor((v.length - 1) * p)];
  const result = {
    elapsedMs: Date.now() - started,
    scope:
      'Real MCP SDK Streamable HTTP and audit persistence, isolated metadata calls; not remote execution throughput',
    clients: timings.map((t) => ({
      count: t.length,
      p50: quantile(t, 0.5),
      p95: quantile(t, 0.95),
      p99: quantile(t, 0.99),
    })),
    revokedClientRejected: true,
    otherClientAlive: true,
    eventLoopP99Ms: delay.percentile(99) / 1e6,
    samples,
  };
  await writeFile('test-results/api-mcp-soak.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, samples: undefined }));
} finally {
  clearInterval(timer);
  delay.disable();
  await Promise.allSettled(clients.map((c) => c.close()));
  await service.stop();
  await rm(directory, { recursive: true, force: true, maxRetries: 5 });
}
