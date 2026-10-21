/** Bound short-lived management connections without relaxing the server's channel limit. */
export class ManagementQueue {
  private queues = new Map<string, { active: number; waiting: Array<() => void> }>();
  async run<T>(key: string, signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
    signal.throwIfAborted();
    let queue = this.queues.get(key);
    if (!queue) {
      queue = { active: 0, waiting: [] };
      this.queues.set(key, queue);
    }
    if (queue.active >= 2) {
      if (queue.waiting.length >= 64) throw Error('此机器的管理请求过多，请稍后重试');
      await new Promise<void>((resolve, reject) => {
        const start = () => {
          signal.removeEventListener('abort', abort);
          resolve();
        };
        const abort = () => {
          queue!.waiting = queue!.waiting.filter((fn) => fn !== start);
          reject(signal.reason ?? Error('操作已取消'));
        };
        queue!.waiting.push(start);
        signal.addEventListener('abort', abort, { once: true });
      });
    } else queue.active++;
    try {
      signal.throwIfAborted();
      return await operation();
    } finally {
      const next = queue.waiting.shift();
      if (next) next();
      else queue.active--;
      if (!queue.active) this.queues.delete(key);
    }
  }
}
