import { z } from 'zod';
import type {
  ConnectionProvider,
  ConnectionTarget,
  ConnectionTool,
  PreparedTool,
  ProviderConnection,
  ResourceScope,
} from './contracts';

const providerId = z.string().regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/);
const capability = z.string().regex(/^[a-z][a-z0-9_.-]{1,99}$/);
function freeze(value: unknown): void {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const item of Object.values(value)) freeze(item);
  }
}
/** Transport-independent dispatch. Only the trusted composition root registers providers. */
export class ConnectionRegistry {
  private providers = new Map<string, ConnectionProvider>();
  private owners = new Map<string, string>();
  private generations = new Map<string, number>();
  private registrations = new Map<string, symbol>();
  constructor(
    private scopeFor: (target: ConnectionTarget) => ResourceScope | undefined,
    /** Legacy session-ID routing; new resource records must bind their provider explicitly. */
    private legacyProvider?: string,
  ) {}
  register(provider: ConnectionProvider) {
    providerId.parse(provider.id);
    z.string()
      .regex(/^\d+\.\d+\.\d+$/)
      .parse(provider.version);
    if (this.providers.has(provider.id)) throw new Error('Provider already registered');
    provider.capabilities.forEach((c) => capability.parse(c));
    this.providers.set(provider.id, provider);
    this.registrations.set(provider.id, Symbol(provider.id));
  }
  unregister(id: string) {
    this.providers.delete(id);
    this.registrations.delete(id);
  }
  bind(connectionId: string, provider: string) {
    if (!this.providers.has(provider)) throw new Error('Unknown provider');
    if (this.owners.get(connectionId)) throw new Error('Connection is already bound');
    const connection = this.providers.get(provider)!.resolve(connectionId);
    if (connection.target.providerId !== provider) throw new Error('Provider identity mismatch');
    this.owners.set(connectionId, provider);
    this.generations.set(connectionId, (this.generations.get(connectionId) || 0) + 1);
  }
  unbind(connectionId: string) {
    this.owners.set(connectionId, '');
    this.generations.set(connectionId, (this.generations.get(connectionId) || 0) + 1);
  }
  private connection(id: string): ProviderConnection {
    const owner = this.owners.has(id) ? this.owners.get(id) : this.legacyProvider;
    const provider = owner && this.providers.get(owner);
    if (!provider) throw new Error('No provider bound to connection');
    const connection = provider.resolve(id);
    if (connection.target.providerId !== provider.id) throw new Error('Provider identity mismatch');
    const names = new Set<string>();
    if (connection.tools.length > 128) throw new Error('Too many connection tools');
    for (const tool of connection.tools) {
      z.string()
        .regex(/^[a-z][a-z0-9_]{0,63}$/)
        .parse(tool.name);
      if (names.has(tool.name) || !provider.capabilities.includes(tool.capability))
        throw new Error('Invalid tool declaration');
      names.add(tool.name);
    }
    return connection;
  }
  activeTargets() {
    return [...this.owners.keys()].flatMap((id) => {
      try {
        const target = this.describe(id);
        return [
          {
            sessionId: id,
            providerId: target.providerId,
            resourceId: target.resourceId,
            label: target.label,
          },
        ];
      } catch {
        return [];
      }
    });
  }
  terminal(id: string) {
    const terminal = this.connection(id).terminal;
    if (!terminal) throw new Error('Terminal capability unavailable');
    return terminal;
  }
  files(id: string) {
    const files = this.connection(id).files;
    if (!files) throw new Error('Files capability unavailable');
    return files;
  }
  describe(id: string) {
    return structuredClone(this.connection(id).target);
  }
  scope(id: string) {
    return this.scopeFor(this.describe(id));
  }
  tools(id: string): readonly ConnectionTool[] {
    return this.connection(id).tools;
  }
  prepare(id: string, name: string, input: unknown): PreparedTool {
    const connection = this.connection(id),
      target = JSON.stringify(connection.target);
    const generation = this.generations.get(id),
      registration = this.registrations.get(connection.target.providerId);
    const tool = connection.tools.find((t) => t.name === name);
    if (!tool) throw new Error('Unknown tool on this connection');
    const args = structuredClone(tool.input.parse(input));
    freeze(args);
    let used = false;
    return Object.freeze({
      capability: tool.capability,
      needsReview: tool.needsReview(args),
      execute: async (authorize: () => boolean, signal: AbortSignal) => {
        if (used) throw new Error('Invocation already consumed');
        used = true;
        signal.throwIfAborted();
        const current = this.connection(id);
        if (
          this.generations.get(id) !== generation ||
          this.registrations.get(connection.target.providerId) !== registration ||
          current !== connection ||
          JSON.stringify(current.target) !== target ||
          !current.tools.includes(tool)
        )
          throw new Error('Connection or capability changed; approval expired');
        if (!authorize()) throw new Error('Capability or resource scope revoked');
        signal.throwIfAborted();
        // No retry: a remote timeout may have happened after a side effect.
        return tool.invoke(args, signal);
      },
    });
  }
}
