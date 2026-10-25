import { createHash } from 'node:crypto';
import { z } from 'zod';
import { CapabilityRuntime } from '../agent/capability-runtime';
import { AgentApplicationService } from '../agent/applications';
import { loadProcessExtensions } from './custom-extensions';
import type { ClientVault } from './client/identity';
import type { InstalledPlugin } from '../shared/plugins';
import type { ConnectionTool } from './connections/contracts';

/** Host-only local extension tools. Never attached to an SSH/CAgent target implicitly. */
export class ProcessExtensions {
  private runtime?: CapabilityRuntime;
  private tools: ConnectionTool[] = [];
  private serial: Promise<unknown> = Promise.resolve();
  private closing = false;
  private invalid: string[] = [];
  constructor(private options: { directory: string; vault: ClientVault; version: string; plugins: () => InstalledPlugin[]; root?: string; changed?: () => void }) {}
  private mutate<T>(action: () => Promise<T>) {
    const operation = this.serial.then(() => { if (this.closing) throw new Error('Extension host is closing'); return action(); });
    this.serial = operation.catch(() => {}); return operation;
  }
  refresh() { return this.mutate(async () => {
    this.tools = []; this.options.changed?.();
    await this.runtime?.dispose(); this.runtime = undefined;
    const installed = this.options.plugins().filter(item => item.manifest.provider === 'process' && item.source.startsWith('custom:'));
    this.invalid = [];
    const packages = (await loadProcessExtensions(this.options.root, id => this.invalid.push(id))).filter(item => installed.some(plugin => plugin.manifest.id === item.entry.id));
    const applications = new AgentApplicationService(this.options.vault, () => false);
    const runtime = new CapabilityRuntime({ directory: this.options.directory, vault: this.options.vault, applications, agentVersion: this.options.version, extraPackages: packages });
    await runtime.load(); this.runtime = runtime;
    // Updating imported code requires a new explicit local grant. Enabling is independent.
    const provisioned = await this.options.vault.read('process-provisioned', z.record(z.string(), z.string())) ?? {};
    for (const pack of packages) {
      const record = runtime.list().find(item => item.id === pack.entry.id);
      const token = `${pack.entry.manifestSha256}:${pack.installToken}`;
      if (!record || provisioned[pack.entry.id] !== token) {
        if (record) await runtime.grant({ id: pack.entry.id, permissions: [] });
        await runtime.install({ id: pack.entry.id, confirm: true });
        provisioned[pack.entry.id] = token;
      }
    }
    for (const record of runtime.list()) if (!packages.some(pack => pack.entry.id === record.id)) await runtime.uninstall({ id: record.id, confirm: true });
    await this.options.vault.write('process-provisioned', provisioned);
    this.rebuild();
  }); }
  list() {
    return [...(this.runtime?.list() ?? []).map(item => ({ ...item, enabled: this.enabled(item.id) })),
      ...this.options.plugins().filter(item=>this.invalid.includes(item.manifest.id)).map(item=>({id:item.manifest.id,name:item.manifest.name,version:item.manifest.version,status:'fault' as const,reason:'扩展文件核验失败，请重新导入',grants:[],requiredPermissions:item.manifest.capability?.permissions??[],registered:false,enabled:item.enabled}))];
  }
  private enabled(id: string) { return this.options.plugins().some(item => item.manifest.id === id && item.manifest.provider === 'process' && item.enabled); }
  authorize(id: string, permissions: string[]) { return this.mutate(async () => {
    if (!this.runtime || !this.enabled(id)) throw new Error('请先启用此自定义扩展');
    await this.runtime.grant({ id, permissions }); this.rebuild();
    return this.list();
  }); }
  private rebuild() {
    const runtime = this.runtime;
    this.tools = runtime ? runtime.tools().filter(tool => this.enabled(tool.packageId)).map(tool => ({
      name: `extension_${createHash('sha256').update(tool.packageId + ':' + tool.toolId).digest('hex').slice(0, 24)}`,
      capability: 'plugins.manage',
      description: `[Local custom extension ${tool.packageId} / ${tool.toolId}] ${tool.description} Runs on the CShell host as the current OS user, not on the selected remote machine.`,
      input: z.fromJSONSchema(tool.inputSchema as Parameters<typeof z.fromJSONSchema>[0]),
      jsonOutput: z.fromJSONSchema(tool.outputSchema as Parameters<typeof z.fromJSONSchema>[0]),
      // Third-party sideEffect annotations can never reduce the review requirement.
      needsReview: () => true,
      conflictDomain: () => `local-extension:${tool.packageId}`,
      invoke: async (input: unknown, signal: AbortSignal) => {
        if (this.runtime !== runtime || !this.enabled(tool.packageId)) throw new Error('Extension was disabled or replaced');
        return JSON.stringify(await runtime.invoke({ packageId: tool.packageId, toolId: tool.toolId, args: input }, 'local', signal));
      },
    })) : [];
    this.options.changed?.();
  }
  applicationTools(): readonly ConnectionTool[] { return this.tools; }
  async dispose() { this.closing = true; await this.serial; this.tools = []; await this.runtime?.dispose(); }
}
