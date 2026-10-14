import { z } from 'zod';

const host = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .refine((value) => !/[\s/\\\x00-\x1f]/.test(value), 'Invalid host');
export const agentRelayConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    bind: host.default('127.0.0.1'),
    port: z.number().int().min(1).max(65535).default(22444),
    targets: z
      .array(
        z
          .object({
            id: z.string().min(1).max(100),
            mode: z.enum(['forward', 'reverse']).default('forward'),
            host: z.string().max(253).default(''),
            port: z.number().int().min(1).max(65535).default(22443),
          })
          .refine(
            (target) => target.mode === 'reverse' || host.safeParse(target.host).success,
            'Forward target requires a valid host',
          ),
      )
      .max(100)
      .default([]),
    maxConnections: z.number().int().min(1).max(128).default(8),
    maxBytesPerTunnel: z
      .number()
      .int()
      .min(1024)
      .max(1024 ** 4)
      .default(256 * 1024 ** 2),
    bytesPerSecond: z
      .number()
      .int()
      .min(1024)
      .max(1024 ** 3)
      .default(8 * 1024 ** 2),
    idleTimeoutMs: z.number().int().min(100).max(3600000).default(60000),
    connectTimeoutMs: z.number().int().min(100).max(60000).default(10000),
  })
  .strict()
  .refine(
    (config) => new Set(config.targets.map((target) => target.id)).size === config.targets.length,
    'Duplicate relay target',
  );
export type AgentRelayConfig = z.infer<typeof agentRelayConfigSchema>;
/** Secret-bearing configuration: only store inside an encrypted device vault. */
export const agentRelayConnectionSchema = z
  .object({
    host,
    port: z.number().int().min(1).max(65535),
    fingerprint: z.string().regex(/^(?:[a-fA-F0-9]{2}:){31}[a-fA-F0-9]{2}$|^[a-fA-F0-9]{64}$/),
    credential: z.string().regex(/^[a-f0-9]{64}$/),
    targetId: z.string().min(1).max(100),
  })
  .strict();
export type AgentRelayConnection = z.infer<typeof agentRelayConnectionSchema>;
/** Safe to copy. Credentials are intentionally not part of connection information. */
export interface AgentRelayEndpoint {
  host: string;
  port: number;
  fingerprint: string;
}
export interface AgentRelayStatus {
  running: boolean;
  config: AgentRelayConfig;
  fingerprint: string;
  activeConnections: number;
  bytesForwarded: number;
  registeredTargets: string[];
}

export const agentReverseRelayConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    relay: agentRelayConnectionSchema.optional(),
    localHost: z.enum(['127.0.0.1', '::1']).default('127.0.0.1'),
    localPort: z.number().int().min(1).max(65535).default(22443),
    maxConnections: z.number().int().min(1).max(128).default(8),
    connectTimeoutMs: z.number().int().min(100).max(60000).default(10000),
  })
  .strict()
  .refine(
    (config) => !config.enabled || !!config.relay,
    'Reverse relay requires a configured relay',
  );
export type AgentReverseRelayConfig = z.infer<typeof agentReverseRelayConfigSchema>;
export interface AgentReverseRelayStatus {
  running: boolean;
  connected: boolean;
  activeConnections: number;
  error?: string;
  config: Omit<AgentReverseRelayConfig, 'relay'> & {
    relay?: Omit<AgentRelayConnection, 'credential'>;
    hasCredential: boolean;
  };
}
