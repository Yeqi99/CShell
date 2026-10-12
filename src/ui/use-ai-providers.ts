import { useSyncExternalStore } from 'react';
import type { AiProvider } from '../shared/ai';

let snapshot: { providers: AiProvider[]; extractionProviderId: string | null } = {
  providers: [],
  extractionProviderId: null,
};
const listeners = new Set<() => void>();
let dispose: (() => void) | undefined;
let revision = 0;
const refresh = async () => {
  const request = ++revision;
  try {
    const next = await window.cshell.aiSnapshot();
    if (request !== revision) return;
    snapshot = { providers: next.providers, extractionProviderId: next.extractionProviderId };
    listeners.forEach((notify) => notify());
  } catch {
    /* Keep the last known configuration during transient IPC failures. */
  }
};
function subscribe(notify: () => void) {
  listeners.add(notify);
  if (listeners.size === 1) {
    dispose = window.cshell.onAiProvidersChanged(() => void refresh());
    void refresh();
  }
  return () => {
    listeners.delete(notify);
    if (!listeners.size) {
      dispose?.();
      dispose = undefined;
    }
  };
}
export function useAiProviders() {
  return useSyncExternalStore(subscribe, () => snapshot);
}
