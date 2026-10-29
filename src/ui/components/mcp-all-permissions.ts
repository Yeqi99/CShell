import { apiCapabilitySchema, type McpSettings, type Profile } from '../../shared/contracts';
import type { LocalShell } from '../../shared/local-terminal';

/** Explicit global action, applied only when the settings draft is saved. */
export function selectAllMcpPermissions(settings: McpSettings, profiles: Profile[], shells: LocalShell[]): McpSettings {
  const grants = {
    allowedProfiles: profiles.filter(p => !p.protocol || ['ssh', 'sftp', 'ftp', 'ftps', 'client', 'http'].includes(p.protocol)).map(p => p.id),
    allowedLocalShells: [...new Set(shells)],
    allowCommands: true,
    capabilities: [...apiCapabilitySchema.options],
    applicationCapabilities: ['plugins.read', 'plugins.manage'] as NonNullable<McpSettings['applicationCapabilities']>,
    review: 'authorized' as const,
    targetPolicies: {},
  };
  const roots = (value: McpSettings['localFileRoots']) => value?.map(root => ({
    ...root, mutations: ['create', 'write', 'rename', 'delete', 'mkdir', 'rmdir', 'renameDirectory'] as NonNullable<NonNullable<McpSettings['localFileRoots']>[number]['mutations']>,
  }));
  return {
    ...settings, ...grants,
    localFileRoots: roots(settings.localFileRoots),
    clients: settings.clients?.map(client => ({ ...client, ...grants, localFileRoots: roots(client.localFileRoots) })),
  };
}
