import { createHash, randomUUID } from 'node:crypto';
import { ApiError, apiFailure } from './errors';

type TaskState =
  'queued' | 'running' | 'cancel_requested' | 'succeeded' | 'failed' | 'cancelled' | 'unknown';
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical((value as Record<string, unknown>)[k])]),
    );
  return value;
}
interface Task {
  id: string;
  owner: string;
  target: string;
  permission: string;
  createdAt: number;
  updatedAt: number;
  state: TaskState;
  controller: AbortController;
  events: { sequence: number; type: string; data: unknown }[];
  sequence: number;
  eventBytes: number;
  result?: unknown;
  error?: ReturnType<typeof apiFailure>;
  idempotencyKey?: string;
  fingerprint: string;
  settled: boolean;
  released?: boolean;
}

/** Process-lifetime asynchronous operations, explicitly not a durable remote process supervisor. */
export class ApiTasks {
  private records = new Map<string, Task>();
  private completions = new Set<Promise<void>>();
  constructor(
    private limits = {
      total: 128,
      perOwner: 32,
      eventBytes: 65536,
      resultBytes: 262144,
      retentionMs: 900000,
    },
  ) {
    for (const value of Object.values(limits))
      if (!Number.isSafeInteger(value) || value < 1) throw new Error('Invalid task limit');
  }
  private prune() {
    const cutoff = Date.now() - this.limits.retentionMs;
    for (const [id, task] of this.records)
      if (task.settled && task.updatedAt < cutoff) this.records.delete(id);
  }
  start(
    owner: string,
    target: string,
    request: unknown,
    key: string | undefined,
    execute: (signal: AbortSignal, output: (text: string) => void) => Promise<unknown>,
    permission = '',
  ) {
    this.prune();
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(canonical(request)))
      .digest('hex');
    if (key) {
      const old = [...this.records.values()].find(
        (t) => t.owner === owner && t.idempotencyKey === key,
      );
      if (old) {
        if (old.fingerprint !== fingerprint || old.target !== target)
          throw new ApiError(
            'CONFLICT',
            'Idempotency key already identifies a different operation.',
            'Use the original request or a new key for a different operation.',
          );
        return this.describe(old);
      }
    }
    if (
      this.records.size >= this.limits.total * 8 ||
      [...this.records.values()].filter((t) => t.owner === owner).length >=
        this.limits.perOwner * 8 ||
      [...this.records.values()].filter((t) => !t.released).length >= this.limits.total ||
      [...this.records.values()].filter((t) => t.owner === owner && !t.released).length >=
        this.limits.perOwner
    )
      throw new ApiError(
        'OVERLOADED',
        'Task retention capacity reached.',
        'Release completed task results or wait for retained keys to expire; do not resubmit running operations.',
      );
    const task: Task = {
      id: randomUUID(),
      owner,
      target,
      permission,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      state: 'queued',
      controller: new AbortController(),
      events: [],
      sequence: 0,
      eventBytes: 0,
      fingerprint,
      idempotencyKey: key,
      settled: false,
    };
    this.records.set(task.id, task);
    this.emit(task, 'state', task.state);
    const completion = Promise.resolve()
      .then(async () => {
        if (task.controller.signal.aborted) {
          task.state = 'cancelled';
          return;
        }
        task.state = 'running';
        this.emit(task, 'state', task.state);
        try {
          const result = await execute(task.controller.signal, (text) => {
            if (task.settled) return;
            // Only serialize the tail that can survive retention. Count discarded events so
            // readers still observe the exact sequence gap without blocking on a huge chunk.
            const chunks = Math.ceil(text.length / 2048);
            const skip = Math.max(0, chunks - Math.ceil(this.limits.eventBytes / 2048) - 1);
            if (skip) {
              task.sequence += skip;
              task.events = [];
              task.eventBytes = 0;
            }
            for (let i = skip * 2048; i < text.length; i += 2048)
              this.emit(task, 'output', text.slice(i, i + 2048));
          });
          let serialized: string;
          try {
            serialized = JSON.stringify(result) ?? 'null';
          } catch {
            throw new ApiError(
              'OUTCOME_UNKNOWN',
              'Task completed without a serializable result.',
              'Inspect the target state. Do not automatically repeat mutations.',
            );
          }
          if (Buffer.byteLength(serialized) > this.limits.resultBytes)
            throw new ApiError(
              'OUTCOME_UNKNOWN',
              'Task result exceeds retention limit.',
              'Read retained output and inspect target state. Do not automatically repeat mutations.',
            );
          // Detach from provider-owned objects; later mutation cannot bypass retention limits.
          task.result = JSON.parse(serialized);
          task.state = task.controller.signal.aborted ? 'unknown' : 'succeeded';
        } catch (error) {
          task.state =
            task.controller.signal.aborted ||
            (error instanceof ApiError && error.code === 'OUTCOME_UNKNOWN')
              ? 'unknown'
              : 'failed';
          task.error = apiFailure(error);
        }
      })
      .finally(() => {
        task.settled = true;
        this.emit(task, 'state', task.state);
        this.completions.delete(completion);
      });
    this.completions.add(completion);
    return this.describe(task);
  }
  private emit(task: Task, type: string, data: unknown) {
    const event = { sequence: ++task.sequence, type, data };
    task.events.push(event);
    task.updatedAt = Date.now();
    task.eventBytes += Buffer.byteLength(JSON.stringify(event));
    while (task.eventBytes > this.limits.eventBytes && task.events.length) {
      task.eventBytes -= Buffer.byteLength(JSON.stringify(task.events.shift()));
    }
  }
  private owned(owner: string, id: string) {
    this.prune();
    const task = this.records.get(id);
    if (!task || task.owner !== owner)
      throw new ApiError(
        'NOT_FOUND',
        'Task is not available to this client.',
        'Use a task ID created by this client within the retention period.',
      );
    return task;
  }
  private describe(t: Task) {
    return {
      taskId: t.id,
      target: t.target,
      permission: t.permission,
      state: t.state,
      settled: t.settled,
      released: !!t.released,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      persistence: 'process-lifetime',
      retentionMs: this.limits.retentionMs,
      result: structuredClone(t.result),
      error: structuredClone(t.error),
    };
  }
  read(owner: string, id: string, after = 0, limit = 50) {
    if (
      !Number.isSafeInteger(after) ||
      after < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      throw new ApiError(
        'INVALID_ARGUMENT',
        'Invalid task event cursor or limit.',
        'Use a nonnegative sequence and a limit from 1 to 100.',
      );
    const task = this.owned(owner, id);
    if (after > task.sequence)
      throw new ApiError(
        'INVALID_ARGUMENT',
        'Cursor is ahead of the task.',
        'Use a cursor returned by this task.',
      );
    const first = task.events[0]?.sequence ?? task.sequence + 1;
    const events = structuredClone(task.events.filter((e) => e.sequence > after).slice(0, limit));
    return {
      ...this.describe(task),
      events,
      gap: after < first - 1,
      nextCursor: events.at(-1)?.sequence ?? after,
      latestCursor: task.sequence,
    };
  }
  cancel(owner: string, id: string) {
    const task = this.owned(owner, id);
    if (!task.settled && !task.controller.signal.aborted) {
      task.state = 'cancel_requested';
      this.emit(task, 'state', task.state);
      task.controller.abort(
        new ApiError(
          'CANCELLED',
          'Cancellation requested.',
          'Read the task outcome; remote termination is not guaranteed.',
        ),
      );
    }
    const { result: _result, error: _error, ...status } = this.describe(task);
    return status;
  }
  release(owner: string, id: string) {
    const task = this.owned(owner, id);
    if (!task.settled)
      throw new ApiError(
        'CONFLICT',
        'The task has not settled.',
        'Cancel or wait for completion before releasing results.',
      );
    task.released = true;
    task.result = undefined;
    task.error = undefined;
    task.events = [];
    task.eventBytes = 0;
    // Preserve ID, fingerprint and original expiry: releasing output must not permit replay.
    return this.describe(task);
  }
  revoke(owner?: string) {
    this.prune();
    for (const task of this.records.values())
      if (!task.settled && (!owner || task.owner === owner)) this.cancel(task.owner, task.id);
  }
  async flush() {
    await Promise.allSettled([...this.completions]);
  }
}
