import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { McpService } from '../src/core/mcp';
import { Store } from '../src/core/store';
import { ApiError } from '../src/core/api/errors';

test('audit backpressure reserves control capacity and bounds completion and rejection records', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cshell-audit-'));
  const store = new Store(directory, {
    encrypt: async (value) => value,
    decrypt: async (value) => value,
  });
  await store.load();
  await store.setMcpSettings({
    enabled: true,
    port: 32199,
    allowedProfiles: [],
    allowCommands: false,
  });
  const service = new McpService(store, directory, async () => false);
  // Hold the writer chain to deterministically simulate a slow disk; no socket or user data.
  const seam = service as unknown as {
    auditWrites: Promise<void>;
    auditPending: number;
    audit(tool: string, ok: boolean, owner: string): Promise<void>;
    endpoint(): {
      call(value: unknown): Promise<{ isError?: boolean; content: { text: string }[] }>;
    };
  };
  let release!: () => void;
  seam.auditWrites = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    const pending = Array.from({ length: 64 }, () => seam.audit('fixture', true, 'legacy'));
    const endpoint = seam.endpoint();
    await assert.rejects(
      endpoint.call({ name: 'list_servers' }),
      (error: unknown) => error instanceof ApiError && error.code === 'OVERLOADED',
    );
    const cancellation = endpoint.call({
      name: 'task_cancel',
      arguments: { taskId: randomUUID() },
    });
    assert.equal(seam.auditPending, 65, 'control attempt fits into reserved audit capacity');
    pending.push(
      ...Array.from({ length: 63 }, () => seam.audit('fixture-result', false, 'legacy')),
    );
    assert.equal(seam.auditPending, 128);
    await assert.rejects(
      seam.audit('overflow', false, 'legacy'),
      (error: unknown) => error instanceof ApiError && error.code === 'OVERLOADED',
    );
    assert.equal(seam.auditPending, 128, 'overflow never extends the writer chain');
    release();
    await Promise.all(pending);
    const result = await cancellation;
    assert.equal(
      JSON.parse(result.content[0].text).code,
      'NOT_FOUND',
      'control reaches ownership validation',
    );
    await seam.auditWrites;
    assert.equal(seam.auditPending, 0);
    const log = await readFile(join(directory, 'mcp-audit.jsonl'), 'utf8');
    assert.ok(log.includes('task_cancel'));
    assert.ok(!log.includes('overflow'));
    assert.equal((await endpoint.call({ name: 'list_servers' })).isError, undefined);
  } finally {
    release();
    await service.stop();
    await rm(directory, { recursive: true, force: true, maxRetries: 5 });
  }
});
