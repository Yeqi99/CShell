import { performance } from 'node:perf_hooks';
import type { McpService } from '../src/core/mcp';

/** Diagnostic hooks for an isolated benchmark instance, never a production service.
 * Durations overlap across requests/stages: sums are not elapsed wall time.
 */
export function measureStages(service: McpService) {
  const target = service as any;
  let samples = new Map<string, number[]>();
  const record = (name: string, began: number) => {
    const values = samples.get(name) ?? [];
    if (values.length < 10_000) values.push(performance.now() - began);
    samples.set(name, values);
  };
  const audit = target.audit;
  target.audit = function (...args: any[]) {
    const began = performance.now();
    return audit.apply(this, args).finally(() => record(`audit-${args[3] ?? 'result'}`, began));
  };
  const scheduler = target.scheduler;
  const run = scheduler.run;
  scheduler.run = function (
    owner: string,
    resource: string,
    lock: string | readonly string[] | undefined,
    signal: AbortSignal,
    fn: () => Promise<unknown>,
  ) {
    const began = performance.now();
    return run.call(this, owner, resource, lock, signal, async () => {
      record('scheduler-wait', began);
      const admitted = performance.now();
      try {
        return await fn();
      } finally {
        record('admitted-handler', admitted);
      }
    });
  };
  const registry = target.manager.tools;
  const prepare = registry.prepare;
  registry.prepare = function (...args: any[]) {
    const prepared = prepare.apply(this, args);
    const execute = prepared.execute;
    return {
      ...prepared,
      execute: async (...input: any[]) => {
        const began = performance.now();
        try {
          return await execute.apply(prepared, input);
        } finally {
          record(`provider-${args[1]}`, began);
        }
      },
    };
  };
  return {
    reset() {
      samples = new Map();
    },
    report() {
      return [...samples].map(([stage, values]) => {
        const sorted = [...values].sort((a, b) => a - b);
        const percentile = (fraction: number) =>
          sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
        return {
          stage,
          samples: values.length,
          totalMs: values.reduce((sum, n) => sum + n, 0),
          p50Ms: percentile(0.5),
          p95Ms: percentile(0.95),
          maxMs: sorted.at(-1),
        };
      });
    },
    restore() {
      target.audit = audit;
      scheduler.run = run;
      registry.prepare = prepare;
    },
  };
}
