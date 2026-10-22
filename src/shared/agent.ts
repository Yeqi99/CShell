import {ideMethods} from './ide';
import {codingMethods} from './coding';
import { z } from 'zod';
export const agentMethods = [
  'network.status','network.configure',
  ...codingMethods,
  ...ideMethods,
  'browser.status','browser.open','browser.read','browser.write','browser.close',
  'visual.status','visual.launch','visual.frame','visual.input','visual.close',
  'wechat.status','wechat.configure','wechat.stop',
  'files.roots','files.list','files.action','files.read','files.uploadStart','files.uploadChunk','files.uploadFinish','files.uploadCancel',
  'connection.autostart',
  'connection.settings',
  'connection.save',
  'assistant.settings',
  'assistant.configure',
  'assistant.start',
  'assistant.tasks',
  'assistant.task',
  'assistant.cancel',
  'packages.catalog',
  'packages.list',
  'packages.tools',
  'packages.invoke',
  'packages.install',
  'packages.grant',
  'packages.uninstall',
  'packages.refresh',
  'desktop.status',
  'desktop.configure',
  'desktop.open',
  'desktop.close',
  'applications.policy',
  'applications.configure',
  'applications.list',
  'applications.plan',
  'applications.install',
  'applications.status',
  'applications.cancel',
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
  bundledApp?: boolean;
};
export interface AgentBridge {
  agentFilePaste(target:string,input:{id:string;root:string;path:string}):Promise<{completed:string[]}>;
  agentFileDownload(target:string,input:{id:string;root:string;path:string;name:string}):Promise<{cancelled?:boolean}>;
  agentFileCancel(id:string):Promise<void>;
  agentMachineOpen(deviceId:string): Promise<AgentTarget>;
  agentMachineClose(target:string): Promise<void>;
  agentTargets(): Promise<AgentTarget[]>;
  agentLaunch(): Promise<void>;
  agentCall(target: string, call: AgentCall): Promise<unknown>;
  agentImportLegacy(): Promise<void>;
  clientShells(deviceId: string): Promise<AgentShellOption[]>;
}
export const agentCapability = (method: string) =>
  method.startsWith('browser.') ? 'http.send' : method.startsWith('hosting.')
    ? 'agent.hosting'
    : method.startsWith('relay.')
      ? 'agent.relay'
      : 'agent.manage';
