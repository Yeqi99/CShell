import { z } from 'zod';
import type { ConnectionTool } from './connections/contracts';
import type { ConnectionRegistry } from './connections/registry';
import type { Store } from './store';

/** Trusted host capabilities. These do not depend on a remote session or expose credentials. */
export function applicationTools(
  store: Store,
  connections: ConnectionRegistry,
  connect?: (profileId: string, signal: AbortSignal) => Promise<string>,
): readonly ConnectionTool[] {
  return [
    ...(connect
      ? [
          {
            name: 'connect_machine',
            capability: 'connections.open',
            description:
              'Open a real CShell terminal session for a saved target by its ID from list_machines. Uses stored credentials without exposing them. Binds subsequent machine tools in this conversation to the new connection. Call this first, then inspect the tools returned in the next model turn. Do not ask for passwords in chat.',
            input: z.object({ profileId: z.string().uuid() }).strict(),
            needsReview: () => false,
            invoke: (input: unknown, signal: AbortSignal) =>
              connect((input as { profileId: string }).profileId, signal),
          },
        ]
      : []),
    {
      name: 'list_machines',
      capability: 'connections.read',
      description:
        'List saved CShell connection targets and groups, including disconnected targets. Returns saved target count, not necessarily unique physical devices. Does not connect or execute commands.',
      input: z.object({}).strict(),
      needsReview: () => false,
      invoke: async () => {
        const snapshot = store.snapshot();
        const machines = snapshot.profiles
          .filter((p) => p.protocol !== 'http')
          .map(({ id, name, host, port, username, group }) => ({
            id,
            name,
            host,
            port,
            username,
            group,
          }));
        return JSON.stringify({ total: machines.length, groups: snapshot.groups, machines });
      },
    },
    {
      name: 'list_sessions',
      capability: 'connections.read',
      description:
        'List currently active CShell sessions. Use list_machines for saved targets, including disconnected ones.',
      input: z.object({}).strict(),
      needsReview: () => false,
      invoke: async () => JSON.stringify({ sessions: connections.activeTargets() }),
    },
  ];
}
