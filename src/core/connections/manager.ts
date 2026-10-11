import type { z } from 'zod';
import type { ConnectionProvider } from './contracts';
import { ConnectionRegistry } from './registry';

/** Trusted host adapter. Secrets are supplied per connection and never retained by Core. */
export interface ManagedProvider extends ConnectionProvider {
  readonly configuration: z.ZodType;
  connect(configuration: unknown, credentials: unknown, signal: AbortSignal): Promise<string>;
  disconnect(id: string): void | Promise<void>;
}

/** Owns lifecycle independently of transport. Tools still pass through registry authorization. */
export class ConnectionManager {
  private providers = new Map<string, ManagedProvider>();
  private owners = new Map<string, ManagedProvider>();
  private opening = new Set<string>();
  constructor(readonly tools: ConnectionRegistry) {}
  register(provider: ManagedProvider) {
    this.tools.register(provider);
    this.providers.set(provider.id, provider);
  }
  async connect(
    providerId: string,
    configuration: unknown,
    credentials: unknown,
    signal = new AbortController().signal,
  ) {
    const provider = this.providers.get(providerId);
    if (!provider) throw new Error('Provider is not installed');
    signal.throwIfAborted();
    const config = structuredClone(provider.configuration.parse(configuration));
    const token = crypto.randomUUID();
    this.opening.add(providerId + ':' + token);
    let id: string | undefined;
    try {
      id = await provider.connect(config, credentials, signal);
      signal.throwIfAborted();
      if (this.providers.get(providerId) !== provider || this.owners.has(id))
        throw new Error('Provider lifecycle changed');
      this.tools.bind(id, providerId);
      this.owners.set(id, provider);
      return id;
    } catch (error) {
      if (id && !this.owners.has(id)) await provider.disconnect(id);
      throw error;
    } finally {
      this.opening.delete(providerId + ':' + token);
    }
  }
  /** Attach a child session created by a trusted provider adapter. Never renderer supplied. */
  adopt(providerId: string, id: string) {
    const provider = this.providers.get(providerId);
    if (!provider || this.owners.has(id)) throw new Error('Invalid provider session');
    this.tools.bind(id, providerId);
    this.owners.set(id, provider);
  }
  async disconnect(id: string) {
    const provider = this.owners.get(id);
    this.closed(id);
    await provider?.disconnect(id);
  }
  /** Transport closed remotely: revoke pending approvals without reconnecting. */
  closed(id: string) {
    this.owners.delete(id);
    this.tools.unbind(id);
  }
  unregister(id: string) {
    if (
      [...this.owners.values()].some((p) => p.id === id) ||
      [...this.opening].some((p) => p.startsWith(id + ':'))
    )
      throw new Error('Disconnect provider sessions before disabling or upgrading');
    this.providers.delete(id);
    this.tools.unregister(id);
  }
  has(id: string) {
    return this.owners.has(id);
  }
  list() {
    return [...this.providers.values()].map((p) => ({
      id: p.id,
      version: p.version,
      capabilities: [...p.capabilities],
    }));
  }
}
