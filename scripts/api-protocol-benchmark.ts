import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir, cpus } from 'node:os';
import { join } from 'node:path';
import { fixture } from '../tests/fixture';
import { Store } from '../src/core/store';
import { SshService } from '../src/core/ssh';
import { McpService } from '../src/core/mcp';
import { measureStages } from './api-benchmark-stages';

// Real HTTP/API/audit/SSH/SFTP against two local fixture servers. Never user targets.
const directory = await mkdtemp(join(tmpdir(), 'cshell-protocol-bench-'));
const remotes: Awaited<ReturnType<typeof fixture>>[] = [];
const store = new Store(directory, {
  encrypt: async (s) => Buffer.from(s).toString('base64'),
  decrypt: async (s) => Buffer.from(s, 'base64').toString(),
});
const service = new McpService(store, directory, async () => true);
const stages = process.env.CSHELL_BENCH_STAGES === '1' ? measureStages(service) : undefined;
const trust = new SshService(
  () => {},
  async (p, fingerprint) => {
    await store.trust(`${p.host}:${p.port}`, fingerprint);
    return true;
  },
);
try {
  await store.load();
  const profiles = [];
  for (let i = 0; i < 2; i++) {
    const remote = await fixture();
    remotes.push(remote);
    await writeFile(join(remote.root, 'payload.bin'), Buffer.alloc(65536, 0xa5));
    await mkdir(join(remote.root, 'mutations'));
    const p = {
      id: randomUUID(),
      name: `fixture-${i}`,
      host: '127.0.0.1',
      port: remote.port,
      username: 'tester',
      auth: 'password' as const,
      group: '',
      favorite: false,
    };
    profiles.push(p);
    await store.saveProfile(p);
    await store.setSecret(p.id, { password: remote.password });
    const opened = await trust.connect(p, { password: remote.password });
    trust.disconnect(opened.sessionId);
  }
  const probe = createServer();
  await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((r) => probe.close(() => r()));
  const owners = Array.from({ length: 3 }, () => randomUUID());
  await service.configure({
    enabled: true,
    port,
    allowedProfiles: [],
    allowCommands: false,
    clients: owners.map((id, i) => ({
      id,
      name: `bench-${i}`,
      enabled: true,
      allowedProfiles: profiles.map((p) => p.id),
      allowCommands: false,
      capabilities: ['files.read', 'files.create', 'metrics.read'],
      review: 'authorized',
      disclosure: { mode: 'progressive', level: 'summary', budgetBytes: 32768 },
    })),
  });
  const tokens = await Promise.all(owners.map((id) => service.accessToken(id)));
  const call = async (owner: number, name: string, args: unknown) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/invoke`, {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${tokens[owner]}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, arguments: args }),
    });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body.error));
    assert.ok(!body.error);
    return body.result;
  };
  const sessions = await Promise.all(
    owners.map(async (_owner, i) =>
      Promise.all(
        profiles.map(
          async (p) => (await call(i, 'connect', { profileId: p.id })).sessionId as string,
        ),
      ),
    ),
  );
  const percentile = (values: number[], p: number) =>
    [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))];
  const measure = async (label: string, count: number, workers: number) => {
    stages?.reset();
    const delay = monitorEventLoopDelay({ resolution: 10 });
    delay.enable();
    const memoryBefore = process.memoryUsage(),
      cpuBefore = process.cpuUsage();
    let peakRss = memoryBefore.rss,
      peakHeap = memoryBefore.heapUsed,
      index = 0;
    const sampler = setInterval(() => {
      const m = process.memoryUsage();
      peakRss = Math.max(peakRss, m.rss);
      peakHeap = Math.max(peakHeap, m.heapUsed);
    }, 10);
    const samples = owners.map(() => [] as number[]);
    const toolSamples = new Map<string, number[]>();
    const start = performance.now();
    try {
      await Promise.all(
        Array.from({ length: workers }, async () => {
          while (index < count) {
            const n = index++,
              owner = n % 3,
              target = Math.floor(n / 3) % 2;
            const operation = [
              { tool: 'read_file_chunk', arguments: { path: 'payload.bin', limitBytes: 65536 } },
              { tool: 'list_files_page', arguments: { path: '.', limit: 20 } },
              { tool: 'read_metrics', arguments: {} },
              {
                tool: 'create_file',
                arguments: { path: `mutations/${label}-${n}.txt`, bodyBase64: 'eA==' },
              },
            ][n % 4];
            const began = performance.now();
            await call(owner, 'invoke_connection', {
              sessionId: sessions[owner][target],
              ...operation,
            });
            const elapsed = performance.now() - began;
            samples[owner].push(elapsed);
            const timings = toolSamples.get(operation.tool) ?? [];
            timings.push(elapsed);
            toolSamples.set(operation.tool, timings);
          }
        }),
      );
    } finally {
      clearInterval(sampler);
      delay.disable();
    }
    const elapsedMs = performance.now() - start,
      all = samples.flat();
    return {
      label,
      operations: count,
      concurrency: workers,
      elapsedMs,
      operationsPerSecond: (count * 1000) / elapsedMs,
      p50Ms: percentile(all, 0.5),
      p95Ms: percentile(all, 0.95),
      p99Ms: percentile(all, 0.99),
      owners: samples.map((v, client) => ({
        client,
        completed: v.length,
        p95Ms: percentile(v, 0.95),
      })),
      tools: [...toolSamples].map(([tool, timings]) => ({
        tool,
        completed: timings.length,
        p50Ms: percentile(timings, 0.5),
        p95Ms: percentile(timings, 0.95),
        p99Ms: percentile(timings, 0.99),
      })),
      eventLoopP99Ms: delay.percentile(99) / 1e6,
      cpuMicroseconds: process.cpuUsage(cpuBefore),
      memoryBefore,
      memoryAfter: process.memoryUsage(),
      peakRss,
      peakHeap,
      stages: stages?.report(),
    };
  };
  // Mutations live below a fixed directory entry, so repeated listing workloads do not grow.
  await measure('warmup', 24, 1);
  const rounds = [];
  for (let round = 0; round < 3; round++) {
    const baseline = await measure('serial-' + round, 36, 1);
    const mixed = await measure('mixed-' + round, 240, 12);
    rounds.push({ baseline, mixed });
  }
  await service.stop();
  const deadline = Date.now() + 5000;
  while (remotes.some((r) => r.connectionsCount()) && Date.now() < deadline)
    await new Promise((r) => setTimeout(r, 20));
  const remainingConnections = remotes.map((r) => r.connectionsCount());
  assert.deepEqual(remainingConnections, [0, 0]);
  const result = {
    measuredAt: new Date().toISOString(),
    node: process.version,
    logicalCores: cpus().length,
    scope:
      'Loopback HTTP API with real SSH/SFTP fixture protocols and audit persistence. CPU/memory include clients and fixtures in this process. No desktop, external machine, Agent, slow-consumer or durable-recovery claim.',
    diagnosticStages: stages
      ? 'Instrumented durations include authorization in provider execution and queue plus filesystem in audit. Stages overlap; do not sum as wall time or compare as an uninstrumented baseline.'
      : undefined,
    rounds,
    remainingConnections,
  };
  await mkdir('test-results', { recursive: true });
  await writeFile(
    stages ? 'test-results/api-protocol-stages.json' : 'test-results/api-protocol-benchmark.json',
    JSON.stringify(result, null, 2),
  );
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} finally {
  await service.stop();
  stages?.restore();
  trust.dispose();
  await Promise.allSettled(remotes.map((r) => r.close()));
  await rm(directory, { recursive: true, force: true, maxRetries: 5 });
}
