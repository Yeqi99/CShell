import { z } from 'zod';
import { clientEndpointSchema } from '../../shared/client';
import { agentRelayConfigSchema, agentReverseRelayConfigSchema, agentRelayConnectionSchema } from '../../shared/agent-relay';
import { wslNetworkInput } from '../../shared/wsl-network';
import { appPlanInput, appTaskInput, appInstallInput } from '../../shared/agent-applications';

const distribution = z.string().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
// This explicit union is the API/MCP allowlist, not the broader trusted Agent RPC list.
// See agent-exposure.ts for required classification of deliberately unexposed methods.
const empty = z.object({}).strict().optional();
const manageParams = {
  'applications.list': empty,
  'applications.plan': appPlanInput,
  'applications.install': appInstallInput,
  'applications.status': appTaskInput,
  'applications.cancel': appTaskInput,
  'agent.shells': empty, 'agent.environments': empty, 'client.status': empty,
  'client.start': z.object({ bind: z.string(), port: z.number().int().min(1024).max(65535), advertisedHost: clientEndpointSchema.shape.host.optional(), advertisedPort: clientEndpointSchema.shape.port.optional() }).strict(),
  'client.stop': empty,
  'client.info': z.object({ host: z.string().max(253) }).strict(),
  'client.revoke': z.object({ fingerprint: z.string().min(1).max(100) }).strict(),
  'agent.logs': empty, 'wsl.check': empty, 'wsl.network.read': empty,
  'wsl.network.save': wslNetworkInput,
  'wsl.network.apply': z.object({ confirmDisconnect: z.literal(true) }).strict(),
  'wsl.plan': z.object({ distribution }).strict(),
  'wsl.install': z.object({ planId: z.string().uuid(), confirm: z.literal(true) }).strict(),
  'wsl.status': empty, 'wsl.logs': empty, 'wsl.cancel': empty,
  'wsl.account.status': z.object({ distribution }).strict(),
  'wsl.account.initialize': z.object({ distribution, username: z.string().regex(/^[a-z_][a-z0-9_-]{0,30}$/), password: z.string().min(1).max(1024).regex(/^[^\0\r\n]+$/), confirm: z.literal(true) }).strict(),
};
const relayParams = {
  'relay.status': empty, 'relay.reverse.status': empty,
  'relay.reverse.configure': z.object({ ...agentReverseRelayConfigSchema.shape,
    expectedRevision: z.string().regex(/^[a-f0-9]{64}$/).describe('revision from this Agent relay.reverse.status; rejected after configuration changes or Agent restart'),
    // Blank/omitted credential only reuses the stored secret for exactly the same endpoint identity.
    relay: agentRelayConnectionSchema.extend({ credential: z.union([agentRelayConnectionSchema.shape.credential, z.literal('')]).optional() }).optional(),
  }).strict().refine((config) => !config.enabled || !!config.relay, 'Reverse relay requires a configured relay'),
  'relay.reverse.start': empty, 'relay.reverse.stop': empty,
  'relay.configure': agentRelayConfigSchema.safeExtend({ expectedRevision: z.string().regex(/^[a-f0-9]{64}$/).describe('revision from this Agent relay.status; rejected after configuration changes or Agent restart') }), 'relay.start': empty, 'relay.stop': empty,
};
function inputFor(params: Record<string, z.ZodType>) {
  const options = Object.entries(params).map(([method, schema]) =>
    z.object({ method: z.literal(method), params: schema }).strict(),
  );
  return z.discriminatedUnion('method', [options[0]!, ...options.slice(1)]);
}
export const agentManageInput = inputFor(manageParams);
export const agentRelayInput = inputFor(relayParams);
