import { CONNECTION_CANCELLED } from '../shared/connection-errors';

/** Pending UI requests are independent of established sessions. */
export class ConnectionAttempts {
  private pending = new Map<string, AbortController>();
  constructor(private disconnect: (id: string) => Promise<void>) {}

  async run(id: string, operation: (signal: AbortSignal) => Promise<{ sessionId: string }>) {
    if (this.pending.has(id)) throw new Error('Connection request already running');
    const controller = new AbortController();
    this.pending.set(id, controller);
    try {
      const result = await operation(controller.signal);
      if (controller.signal.aborted) {
        await this.disconnect(result.sessionId);
        throw controller.signal.reason;
      }
      return result;
    } finally {
      this.pending.delete(id);
    }
  }

  cancel(id: string) {
    this.pending.get(id)?.abort(new Error(CONNECTION_CANCELLED));
  }

  dispose() {
    for (const id of this.pending.keys()) this.cancel(id);
  }
}
