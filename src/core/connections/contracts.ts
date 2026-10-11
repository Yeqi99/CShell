import type { z } from 'zod';

/** Host-internal contract v0. Not an arbitrary-JavaScript plugin loading API. */
export interface ConnectionTarget {
  readonly providerId: string;
  readonly resourceId: string;
  /** Opaque, credential-free identity of the endpoint; changes invalidate grants. */
  readonly identity: string;
  readonly label: string;
}
export interface ConnectionTool {
  readonly name: string;
  readonly capability: string;
  readonly description: string;
  readonly input: z.ZodType;
  /** Trusted built-in policy only. External annotations may increase, never lower risk. */
  readonly needsReview: (input: unknown) => boolean;
  invoke(input: unknown, signal: AbortSignal): Promise<string>;
}
export interface ProviderConnection {
  readonly target: ConnectionTarget;
  /** Same instance for a live connection; reconnect must create a new instance. */
  readonly tools: readonly ConnectionTool[];
}
export interface ConnectionProvider {
  readonly id: string;
  readonly version: string;
  readonly capabilities: readonly string[];
  /** Must throw for disconnected or unowned connections. */
  resolve(connectionId: string): ProviderConnection;
}
export interface ResourceScope {
  id: string;
  group: string;
}
export interface PreparedTool {
  readonly capability: string;
  readonly needsReview: boolean;
  /** Single-use; revalidates target, tool and host permissions after approval. */
  execute(authorize: () => boolean, signal: AbortSignal): Promise<string>;
}
