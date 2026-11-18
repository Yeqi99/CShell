import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ConnectionTool } from './connections/contracts';
import type { ConnectionRegistry } from './connections/registry';
import type { Store } from './store';

/** Trusted host capabilities. These do not depend on a remote session or expose credentials. */
export function applicationTools(
  store: Store,
  connections: ConnectionRegistry,
  connect?: (profileId: string, signal: AbortSignal) => Promise<string>,
  profileSaved?: () => void,
): readonly ConnectionTool[] {
  return [
    {
      name: 'create_ssh_connection',
      capability: 'connections.manage',
      description: 'Save an SSH connection for the host, port and username the user specified. Returns the profileId for connect_machine. Credentials and host identity confirmation are handled by CShell. Never request a password or private key in chat.',
      input: z.object({host:z.string().trim().min(1).max(255),port:z.number().int().min(1).max(65535).default(22),username:z.string().trim().min(1).max(255),name:z.string().trim().min(1).max(100).optional()}).strict(),
      needsReview: () => false,
      invoke: async (input,signal) => {
        signal.throwIfAborted();
        const {host,port,username,name}=input as {host:string;port:number;username:string;name?:string};
        const existing=store.snapshot().profiles.find(p=>(p.protocol??'ssh')==='ssh' && p.host===host && p.port===port && p.username===username && !p.jumpProfileId);
        if(existing)return JSON.stringify({profileId:existing.id,created:false,host,port,username});
        const id=randomUUID();
        await store.saveProfile({id,protocol:'ssh',name:name??host,host,port,username,group:'',auth:'password',favorite:false});
        profileSaved?.();
        return JSON.stringify({profileId:id,created:true,host,port,username});
      }
    },
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
        parallelRead: true,
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
        parallelRead: true,
      capability: 'connections.read',
      description:
        'List currently active CShell sessions. Use list_machines for saved targets, including disconnected ones.',
      input: z.object({}).strict(),
      needsReview: () => false,
      invoke: async () => JSON.stringify({ sessions: connections.activeTargets() }),
    },
  ];
}
