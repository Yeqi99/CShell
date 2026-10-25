import type { FileEntry } from '../../shared/contracts';
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
  /** When present, invoke returns a JSON string whose parsed content must match this schema. */
  readonly jsonOutput?: z.ZodType;
  readonly examples?: { input: unknown; explanation: string }[];
  /** Trusted built-in policy only. External annotations may increase, never lower risk. */
  readonly needsReview: (input: unknown) => boolean;
  /** Shared resource mutation domain within this target. Undefined means no declared conflict. */
  readonly conflictDomain?: (input: unknown) => string | readonly string[] | undefined;
  /** Long-lived built-ins recheck this guard before each delayed side effect. */
  invoke(input: unknown, signal: AbortSignal, output?: (text: string) => void, guard?: () => void): Promise<string>;
}
export interface ProviderConnection {
  readonly agent?: (
    call: import('../../shared/agent').AgentCall,
    signal: AbortSignal,
  ) => Promise<unknown>;
  readonly http?: (
    request: import('../../shared/http').HttpWireRequest,
    signal: AbortSignal,
  ) => Promise<import('../../shared/http').HttpResponse>;
  readonly target: ConnectionTarget;
  /** Same instance for a live connection; reconnect must create a new instance. */
  readonly tools: readonly ConnectionTool[];
  readonly terminal?: {
    input(data: string): void;
    resize(cols: number, rows: number): void;
    acknowledge(characters: number): void;
  };
  readonly files?: { list(path: string): Promise<{ path: string; entries: FileEntry[] }> };
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
  execute(
    authorize: () => boolean,
    signal: AbortSignal,
    output?: (text: string) => void,
  ): Promise<string>;
}
