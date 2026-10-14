import { z } from 'zod';
export const agentMethods = [
  'agent.shells',
  'agent.environments',
  'client.status',
  'client.reconfigure',
  'client.access',
  'client.start',
  'client.stop',
  'client.info',
  'client.revoke',
  'agent.logs',
  'wsl.check',
  'wsl.network.read',
  'wsl.network.save',
  'wsl.network.apply',
  'wsl.plan',
  'wsl.install',
  'wsl.status',
  'wsl.logs',
  'wsl.cancel',
  'wsl.account.status',
  'wsl.account.initialize',
  'hosting.list',
  'hosting.save',
  'hosting.start',
  'hosting.stop',
  'hosting.logs',
  'hosting.remove',
  'relay.status',
  'relay.registrationCredential',
  'relay.rotateRegistrationCredential',
  'relay.reverse.status',
  'relay.reverse.configure',
  'relay.reverse.start',
  'relay.reverse.stop',
  'relay.configure',
  'relay.start',
  'relay.stop',
  'relay.rotateCredential',
  'relay.revealCredential',
] as const;
export const agentCallSchema = z
  .object({ method: z.enum(agentMethods), params: z.unknown().optional() })
  .strict();
export type AgentCall = z.infer<typeof agentCallSchema>;
export type AgentShellOption = { shell: string; label: string; distribution?: string };
export type AgentTarget = {
  id: string;
  name: string;
  local: boolean;
  available: boolean;
  reason?: string;
};
export interface AgentBridge {
  agentTargets(): Promise<AgentTarget[]>;
  agentCall(target: string, call: AgentCall): Promise<unknown>;
  agentImportLegacy(): Promise<void>;
  clientShells(deviceId: string): Promise<AgentShellOption[]>;
}
export const agentCapability = (method: string) =>
  method.startsWith('hosting.')
    ? 'agent.hosting'
    : method.startsWith('relay.')
      ? 'agent.relay'
      : 'agent.manage';
