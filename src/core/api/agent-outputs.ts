import { z } from 'zod';
import { clientShellSchema } from '../../shared/client';
import {
  agentRelayConfigSchema,
  agentReverseRelayConfigSchema,
  agentRelayConnectionSchema,
} from '../../shared/agent-relay';
import { hostingConfigSchema } from '../../shared/agent-hosting';
import { appCatalogSchema, appTaskSchema } from '../../shared/agent-applications';

const log = z
  .object({
    time: z.string(),
    action: z.string(),
    peer: z.string().optional(),
    error: z.string().optional(),
  })
  .strict();
const status = z
  .object({
    passwordConfigured: z.boolean(),
    allowedShells: z.array(clientShellSchema),
    allowHttp: z.boolean(),
    allowManage: z.boolean(),
    allowHosting: z.boolean(),
    allowRelay: z.boolean(),
    running: z.boolean(),
    deviceId: z.string(),
    fingerprint: z.string(),
    port: z.number().optional(),
    bind: z.string().optional(),
    advertisedHost: z.string().optional(),
    advertisedPort: z.number().int().optional(),
    peers: z.array(
      z
        .object({
          fingerprint: z.string(),
          name: z.string(),
          shells: z.array(clientShellSchema),
          connected: z.number(),
          allowHttp: z.boolean(),
          allowManage: z.boolean(),
          allowHosting: z.boolean(),
          allowRelay: z.boolean(),
        })
        .strict(),
    ),
    audit: z.array(log),
    canImportLegacy: z.boolean().optional(),
    platform: z.string().optional(),
    interfaces: z.array(z.string()).optional(),
    agentVersion: z.string().min(1).max(64).optional(),
    methods: z.array(z.string().min(1).max(120)).max(1024).optional(),
    updateProtocol: z.number().int().nonnegative().optional(),
    updatePendingCommit: z.boolean().optional(),
    activity: z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,63}$/),z.number().int().nonnegative()).optional(),
  })
  .strict();
const installation = z
  .object({
    id: z.string().uuid(),
    distribution: z.string(),
    args: z.array(z.string()),
    state: z.enum([
      'planned',
      'running',
      'completed',
      'failed',
      'cancelled',
      'interrupted',
      'restart-required',
    ]),
    logs: z.string(),
    code: z.number().optional(),
  })
  .strict();
const account = z.object({ distribution: z.string(), ready: z.boolean() }).strict();
const network = z
  .object({
    revision: z.string(),
    mode: z.string(),
    autoProxy: z.boolean(),
    mirroredSupported: z.boolean(),
    localhostProxy: z.boolean(),
  })
  .strict();
const relay = z
  .object({
    revision: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    running: z.boolean(),
    config: agentRelayConfigSchema,
    fingerprint: z.string(),
    activeConnections: z.number(),
    bytesForwarded: z.number(),
    registeredTargets: z.array(z.string()),
  })
  .strict();
const reverse = z
  .object({
    revision: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    running: z.boolean(),
    connected: z.boolean(),
    activeConnections: z.number(),
    error: z.string().optional(),
    config: z
      .object({
        ...agentReverseRelayConfigSchema.shape,
        relay: agentRelayConnectionSchema.omit({ credential: true }).strict().optional(),
        hasCredential: z.boolean(),
      })
      .strict(),
  })
  .strict();
const hosting = z
  .object({
    config: hostingConfigSchema,
    running: z.boolean(),
    actualPort: z.number().optional(),
    error: z.string().optional(),
    environment: z.enum(['windows', 'linux', 'darwin']),
  })
  .strict();
const shells = z.array(
  z.object({ shell: z.string(), label: z.string(), distribution: z.string().optional() }).strict(),
);
export const agentMethodOutputs: Record<string, z.ZodType> = {
  // Only methods in the API input allowlist; trusted-only RPC exclusions live in agent-exposure.ts.
  'applications.list': appCatalogSchema,
  'applications.plan': appTaskSchema,
  'applications.install': appTaskSchema,
  'applications.status': appTaskSchema,
  'applications.cancel': appTaskSchema,
  'agent.shells': shells,
  'agent.environments': shells,
  'client.status': status,
  'client.start': status,
  'client.revoke': status,
  'client.stop': z.union([
    status,
    z.object({ stopping: z.literal(true), disconnects: z.literal(true) }).strict(),
  ]),
  'client.info': z
    .string()
    .describe('JSON connection information string, without password or invitation token.'),
  'agent.logs': z.array(log),
  'wsl.check': z
    .object({
      supported: z.boolean(),
      administrator: z.boolean().optional(),
      virtualization: z.boolean().optional(),
      rebootPending: z.boolean().optional(),
      distributions: z.array(z.string()),
      online: z.array(z.string()),
      onlineError: z.string().optional(),
      installation: installation.optional(),
    })
    .strict(),
  'wsl.plan': installation.extend({
    administrator: z.boolean(),
    mayRequireAdministrator: z.literal(true),
    mayRequireRestart: z.literal(true),
  }),
  'wsl.install': installation.nullable(),
  'wsl.status': installation.nullable(),
  'wsl.logs': installation.nullable(),
  'wsl.cancel': installation.nullable(),
  'wsl.account.status': account,
  'wsl.account.initialize': account,
  'wsl.network.read': network,
  'wsl.network.save': network,
  'wsl.network.apply': z
    .object({ applied: z.literal(true), disconnects: z.literal(true) })
    .strict(),
  'relay.status': relay,
  'relay.configure': relay,
  'relay.start': relay,
  'relay.stop': relay,
  'relay.reverse.status': reverse,
  'relay.reverse.configure': reverse,
  'relay.reverse.start': reverse,
  'relay.reverse.stop': reverse,
  'hosting.list': z.array(hosting),
  'hosting.save': hosting,
  'hosting.start': hosting,
  'hosting.stop': hosting,
  'hosting.remove': z.null(),
  'hosting.logs': z.array(
    z
      .object({
        time: z.string(),
        method: z.string(),
        path: z.string(),
        status: z.number(),
        durationMs: z.number(),
        body: z.string().optional(),
        truncated: z.boolean().optional(),
        error: z.string().optional(),
      })
      .strict(),
  ),
};
export function agentOutputContract(capability: string) {
  const entries = Object.entries(agentMethodOutputs).filter(([method]) =>
    capability === 'agent.hosting'
      ? method.startsWith('hosting.')
      : capability === 'agent.relay'
        ? method.startsWith('relay.')
        : !/^(hosting|relay)\./.test(method),
  );
  return z.union(
    entries.map(([method, schema]) => schema.describe(`Result of ${method}`)) as [
      z.ZodType,
      z.ZodType,
      ...z.ZodType[],
    ],
  );
}
