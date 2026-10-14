import { useEffect, useRef } from 'react';
import { CONNECTION_CANCELLED } from '../shared/connection-errors';

/** Hidden workspace pages stay mounted; only closing a page cancels its work. */
export function useConnectionAttempt() {
  const current = useRef<AbortController | null>(null);
  const cancel = () => current.current?.abort(new Error(CONNECTION_CANCELLED));
  useEffect(() => () => current.current?.abort(new Error(CONNECTION_CANCELLED)), []);
  return {
    cancel,
    async run<T>(operation: (signal: AbortSignal) => Promise<T>) {
      if (current.current) throw new Error('Connection already running');
      const controller = new AbortController();
      current.current = controller;
      try {
        const result = await operation(controller.signal);
        controller.signal.throwIfAborted();
        return result;
      } finally {
        if (current.current === controller) current.current = null;
      }
    },
  };
}
