import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { mkdir, writeFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import { z } from 'zod';
import { CapabilityCatalog, disclosureLevels } from '../src/core/api/catalog';
import { ApiScheduler } from '../src/core/api/scheduler';

// Reproducible in-process load, not a claim about SSH throughput or remote durability.
const catalog = new CapabilityCatalog(
  Array.from({ length: 200 }, (_, i) => ({
    id: `operation_${String(i).padStart(3, '0')}`,
    name: `Operation ${i}`,
    description: 'Read a bounded resource snapshot.',
    input: z
      .object({ path: z.string().max(4096), limit: z.number().int().min(1).max(100).default(20) })
      .strict(),
    output: { type: 'object' },
    permission: 'files.read',
    effects: 'read' as const,
    target: 'connection',
    prerequisites: ['Explicit resource grant'],
    cancellation: 'Cooperative cancellation',
    retry: 'Reads may be repeated',
    examples: [{ input: { path: '.', limit: 20 }, explanation: 'Read one page' }],
  })),
);
const delay = monitorEventLoopDelay({ resolution: 10 });
delay.enable();
const memoryBefore = process.memoryUsage();
const levels = [];
for (const level of disclosureLevels) {
  let cursor: string | undefined,
    pages = 0,
    bytes = 0;
  const times = [];
  do {
    const start = performance.now();
    const page = catalog.discover('benchmark', '1', () => true, {
      level,
      budgetBytes: 32768,
      limit: 100,
      cursor,
    });
    times.push(performance.now() - start);
    bytes += Buffer.byteLength(JSON.stringify(page));
    pages++;
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  const samples = [];
  for (let i = 0; i < 500; i++) {
    const start = performance.now();
    catalog.discover('benchmark', '1', () => true, { level, query: 'operation_01', limit: 10 });
    samples.push(performance.now() - start);
    if (i % 20 === 0) await new Promise<void>((r) => setImmediate(r));
  }
  samples.sort((a, b) => a - b);
  levels.push({
    level,
    pages,
    bytes,
    completeDiscoveryMs: times.reduce((a, b) => a + b, 0),
    searchP50Ms: samples[250],
    searchP95Ms: samples[475],
    searchP99Ms: samples[495],
  });
}
const scheduler = new ApiScheduler({
  total: 16,
  perOwner: 4,
  perTarget: 4,
  queued: 128,
  queuedPerOwner: 32,
});
const latencies: number[] = [];
const started = performance.now();
for (let round = 0; round < 20; round++) {
  await Promise.all(
    Array.from({ length: 64 }, async (_, i) => {
      const start = performance.now();
      await scheduler.run(
        `client${i % 8}`,
        `target${i % 16}`,
        i % 2 ? 'mutation' : undefined,
        new AbortController().signal,
        () => new Promise<void>((r) => setTimeout(r, 1)),
      );
      latencies.push(performance.now() - start);
    }),
  );
}
latencies.sort((a, b) => a - b);
delay.disable();
const result = {
  measuredAt: new Date().toISOString(),
  environment: { node: process.version, platform: process.platform, logicalCores: cpus().length },
  scope:
    'Synthetic local catalog and scheduler only. Includes 1ms simulated operations. No remote/network/UI throughput claim.',
  levels,
  load: {
    operations: latencies.length,
    elapsedMs: performance.now() - started,
    p50Ms: latencies[Math.floor(latencies.length * 0.5)],
    p95Ms: latencies[Math.floor(latencies.length * 0.95)],
    p99Ms: latencies[Math.floor(latencies.length * 0.99)],
    final: scheduler.snapshot(),
  },
  eventLoopP99Ms: delay.percentile(99) / 1e6,
  memoryBefore,
  memoryAfter: process.memoryUsage(),
};
await mkdir('test-results', { recursive: true });
await writeFile('test-results/api-foundation-benchmark.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
