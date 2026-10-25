import { z } from 'zod';
import { ApiError } from '../api/errors';
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
  private generation = 0;
  private registrations = new Map<string, symbol>();
  private toolSources = new Map<string, { capabilities: ReadonlySet<string>; tools: (id: string, connection: ProviderConnection) => readonly ConnectionTool[] }>();
  private toolSourceGeneration = 0;
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
  /** Trusted composition-root contributions; never accepts code or grants from a renderer. */
  registerToolSource(id: string, capabilities: readonly string[], tools: (id: string, connection: ProviderConnection) => readonly ConnectionTool[]) {
    providerId.parse(id);
    if (this.toolSources.has(id)) throw new Error('Tool source already registered');
    capabilities.forEach(value => capability.parse(value));
    const source = { capabilities: new Set(capabilities), tools };
    this.toolSources.set(id, source); this.toolSourceGeneration++;
    return () => {
      if (this.toolSources.get(id) === source) { this.toolSources.delete(id); this.toolSourceGeneration++; }
    };
  }
  private allTools(id: string, connection: ProviderConnection) {
    const result = [...connection.tools], names = new Set(result.map(tool => tool.name));
    for (const source of this.toolSources.values()) for (const tool of source.tools(id, connection)) {
      z.string().regex(/^[a-z][a-z0-9_]{0,63}$/).parse(tool.name);
      if (names.has(tool.name) || !source.capabilities.has(tool.capability)) throw new Error('Invalid contributed tool declaration');
      names.add(tool.name); result.push(tool);
      if (result.length > 256) throw new Error('Too many connection tools');
    }
    return result;
  }
  bind(connectionId: string, provider: string) {
    if (!this.providers.has(provider)) throw new Error('Unknown provider');
    if (this.owners.get(connectionId)) throw new Error('Connection is already bound');
    const connection = this.providers.get(provider)!.resolve(connectionId);
    if (connection.target.providerId !== provider) throw new Error('Provider identity mismatch');
    this.owners.set(connectionId, provider);
    this.generations.set(connectionId, ++this.generation);
  }
  unbind(connectionId: string) {
    if (this.legacyProvider) this.owners.set(connectionId, '');
    else this.owners.delete(connectionId);
    this.generations.delete(connectionId);
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
  supportsHttp(id: string) {
    try {
      return !!this.connection(id).http;
    } catch {
      return false;
    }
  }
  agent(id:string){
    const connection=this.connection(id);
    if(!connection.agent)throw new Error('此连接没有 CAgent 管理能力');
    return (call:import('../../shared/agent').AgentCall,signal:AbortSignal)=>{
      if(this.connection(id)!==connection)throw new Error('CAgent 连接已改变');
      return connection.agent!(call,signal);
    };
  }
  http(id: string) {
    const connection = this.connection(id);
    if (!connection.http) throw new Error('此发送方不支持 HTTP');
    return (request: import('../../shared/http').HttpWireRequest, signal: AbortSignal) => {
      if (this.connection(id) !== connection) throw new Error('发送方已改变');
      return connection.http!(request, signal);
    };
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
    return this.allTools(id, this.connection(id));
  }
  prepare(id: string, name: string, input: unknown): PreparedTool {
    const connection = this.connection(id),
      target = JSON.stringify(connection.target);
    const generation = this.generations.get(id),
      registration = this.registrations.get(connection.target.providerId);
    const toolSourceGeneration = this.toolSourceGeneration;
    const tool = this.allTools(id, connection).find((t) => t.name === name);
    if (!tool) throw new Error('Unknown tool on this connection');
    const args = structuredClone(tool.input.parse(input));
    freeze(args);
    let used = false;
    return Object.freeze({
      capability: tool.capability,
      needsReview: tool.needsReview(args),
      execute: async (
        authorize: () => boolean,
        signal: AbortSignal,
        output?: (text: string) => void,
      ) => {
        if (used) throw new Error('Invocation already consumed');
        used = true;
        signal.throwIfAborted();
        const guard=()=>{
        signal.throwIfAborted();
        const current = this.connection(id);
        if (
          this.generations.get(id) !== generation ||
          this.registrations.get(connection.target.providerId) !== registration ||
          current !== connection ||
          JSON.stringify(current.target) !== target ||
          this.toolSourceGeneration !== toolSourceGeneration ||
          !this.allTools(id, current).includes(tool)
        )
          throw new Error('Connection or capability changed; approval expired');
        if (!authorize()) throw new Error('Capability or resource scope revoked');
        signal.throwIfAborted();
        };
        guard();
        // No retry: a remote timeout may have happened after a side effect.
        const result = await tool.invoke(args, signal, output, guard);
        if (tool.jsonOutput) {
          try {
            tool.jsonOutput.parse(JSON.parse(result));
          } catch {
            throw new ApiError(
              'OUTCOME_UNKNOWN',
              'Provider result did not match its declared contract.',
              'Inspect the target before retrying a mutation; execution may already have completed.',
            );
          }
        }
        return result;
      },
    });
  }
}
