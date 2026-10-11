import type { TerminalSnapshot } from '../shared/floating';
import type { SessionEvent } from '../shared/contracts';
const backlog = new Map<string, { data: string; sequence: number }>();
const listeners = new Map<string, (data: string, sequence: number) => void>();
const closed = new Set<string>();
export function terminalClosed(id: string) {
  return closed.has(id);
}
export function terminalEvent(event: SessionEvent) {
  if (event.type === 'closed') {
    closed.add(event.sessionId);
    if (closed.size > 1000) closed.delete(closed.values().next().value!);
  }
  if (event.type !== 'data') return;
  const listener = listeners.get(event.sessionId);
  if (listener) listener(event.data, event.sequence || 0);
  else
    backlog.set(event.sessionId, {
      data: ((backlog.get(event.sessionId)?.data || '') + event.data).slice(-2_000_000),
      sequence: event.sequence || 0,
    });
}
export function subscribeTerminal(id: string, listener: (data: string, sequence: number) => void) {
  listener(backlog.get(id)?.data || '', backlog.get(id)?.sequence || 0);
  backlog.delete(id);
  listeners.set(id, listener);
  return () => {
    listeners.delete(id);
    backlog.delete(id);
  };
}

const snapshots = new Map<string, () => Promise<TerminalSnapshot>>();
export function registerTerminalSnapshot(id: string, snapshot: () => Promise<TerminalSnapshot>) {
  snapshots.set(id, snapshot);
  return () => {
    snapshots.delete(id);
  };
}
export function terminalSnapshot(id: string) {
  const snapshot = snapshots.get(id);
  if (!snapshot) return Promise.reject(new Error('终端尚未准备好'));
  return snapshot();
}
