import { ApiError } from './errors';

/** Tree reservations conflict with descendant file/tree mutations, with component boundaries. */
export function conflictKeysOverlap(left: string, right: string) {
  if (left === right) return true;
  const [lt, ld] = JSON.parse(left) as [string, string];
  const [rt, rd] = JSON.parse(right) as [string, string];
  if (lt !== rt) return false;
  const contains = (tree: string, other: string) => {
    if (!tree.startsWith('tree:') || !(other.startsWith('file:') || other.startsWith('tree:')))
      return false;
    const root = tree.slice(5),
      path = other.slice(5);
    return path === root || path.startsWith(root.endsWith('/') ? root : root + '/');
  };
  return contains(ld, rd) || contains(rd, ld);
}

interface Pending {
  owner: string;
  target: string;
  locks: readonly string[];
  signal: AbortSignal;
  grant: () => void;
  reject: (e: Error) => void;
  abort: () => void;
}

/** Bounded admission with round-robin owners. Locks cover mutations, not entire machines. */
export class ApiScheduler {
  private active = 0;
  private owners = new Map<string, number>();
  private targets = new Map<string, number>();
  private locks = new Set<string>();
  private queue: Pending[] = [];
  private pendingOwners: string[] = [];
  private lastOwner?: string;
  constructor(
    readonly limits = { total: 16, perOwner: 4, perTarget: 4, queued: 64, queuedPerOwner: 16 },
    readonly queueTimeoutMs = 30_000,
  ) {
    for (const n of Object.values(limits))
      if (!Number.isSafeInteger(n) || n < 1) throw new Error('Invalid scheduler limit');
    if (
      !Number.isSafeInteger(queueTimeoutMs) ||
      queueTimeoutMs < 1 ||
      queueTimeoutMs > 2_147_483_647
    )
      throw new Error('Invalid queue timeout');
  }
  snapshot() {
    return { active: this.active, queued: this.queue.length };
  }
  async run<T>(
    owner: string,
    target: string,
    lock: string | readonly string[] | undefined,
    signal: AbortSignal,
    fn: () => Promise<T>,
  ): Promise<T> {
    signal.throwIfAborted();
    if (
      this.queue.length >= this.limits.queued ||
      this.queue.filter((p) => p.owner === owner).length >= this.limits.queuedPerOwner
    )
      throw new ApiError(
        'OVERLOADED',
        'Execution queue is full.',
        'Wait for existing tasks to finish before submitting more.',
      );
    const domains = lock === undefined ? [] : typeof lock === 'string' ? [lock] : [...lock];
    if (
      domains.length > 8 ||
      domains.some((value) => typeof value !== 'string' || value.length > 8192)
    )
      throw new ApiError(
        'INVALID_ARGUMENT',
        'Invalid conflict domains.',
        'Use at most eight bounded resource domains.',
      );
    const lockKeys = [...new Set(domains)].map((value) => JSON.stringify([target, value]));
    const deadline = performance.now() + this.queueTimeoutMs;
    const expired = () =>
      new ApiError(
        'DEADLINE_EXCEEDED',
        'Execution queue wait expired; the operation did not start.',
        'Wait for competing operations to finish before submitting again.',
      );
    await new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>;
      const remove = (reason: unknown) => {
        const index = this.queue.indexOf(p);
        if (index < 0) return;
        clearTimeout(timer);
        signal.removeEventListener('abort', p.abort);
        this.queue.splice(index, 1);
        this.removeEmptyOwner(owner);
        reject(reason);
        this.drain();
      };
      const p: Pending = {
        owner,
        target,
        locks: lockKeys,
        signal,
        grant: () => {
          clearTimeout(timer);
          resolve();
        },
        reject,
        abort: () => remove(signal.reason),
      };
      timer = setTimeout(() => remove(expired()), this.queueTimeoutMs);
      signal.addEventListener('abort', p.abort, { once: true });
      this.queue.push(p);
      if (!this.pendingOwners.includes(owner)) this.pendingOwners.push(owner);
      this.drain();
    });
    try {
      signal.throwIfAborted();
      if (performance.now() >= deadline) throw expired();
      return await fn();
    } finally {
      this.active--;
      this.decrement(this.owners, owner);
      this.decrement(this.targets, target);
      for (const key of lockKeys) this.locks.delete(key);
      this.drain();
    }
  }
  private decrement(map: Map<string, number>, key: string) {
    const n = (map.get(key) ?? 1) - 1;
    if (n) map.set(key, n);
    else map.delete(key);
  }
  private removeEmptyOwner(owner: string) {
    if (!this.queue.some((p) => p.owner === owner))
      this.pendingOwners = this.pendingOwners.filter((id) => id !== owner);
  }
  private drain() {
    while (this.active < this.limits.total) {
      if (this.pendingOwners.length > 1 && this.pendingOwners[0] === this.lastOwner)
        this.pendingOwners.push(this.pendingOwners.shift()!);
      const eligible = (p: Pending) =>
        (this.owners.get(p.owner) ?? 0) < this.limits.perOwner &&
        (this.targets.get(p.target) ?? 0) < this.limits.perTarget &&
        p.locks.every((key) => ![...this.locks].some((active) => conflictKeysOverlap(key, active)));
      let index = -1;
      for (const owner of this.pendingOwners) {
        index = this.queue.findIndex((p) => p.owner === owner && eligible(p));
        if (index >= 0) break;
      }
      if (index < 0) return;
      const [p] = this.queue.splice(index, 1);
      p.signal.removeEventListener('abort', p.abort);
      this.active++;
      this.owners.set(p.owner, (this.owners.get(p.owner) ?? 0) + 1);
      this.targets.set(p.target, (this.targets.get(p.target) ?? 0) + 1);
      // Reserve all domains synchronously, or none. Never hold one while waiting for another.
      for (const key of p.locks) this.locks.add(key);
      this.pendingOwners = this.pendingOwners.filter((id) => id !== p.owner);
      if (this.queue.some((item) => item.owner === p.owner)) this.pendingOwners.push(p.owner);
      this.lastOwner = p.owner;
      p.grant();
    }
  }
}
