import type { SessionEvent } from '../shared/contracts';
const backlog = new Map<string, string>();
const listeners = new Map<string, (data: string) => void>();
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
  if (listener) listener(event.data);
  else
    backlog.set(
      event.sessionId,
      ((backlog.get(event.sessionId) || '') + event.data).slice(-2_000_000),
    );
}
export function subscribeTerminal(id: string, listener: (data: string) => void) {
  listener(backlog.get(id) || '');
  backlog.delete(id);
  listeners.set(id, listener);
  return () => {
    listeners.delete(id);
    backlog.delete(id);
  };
}
