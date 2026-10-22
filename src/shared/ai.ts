import { z } from 'zod';
export const aiLocations = ['workspace', 'terminal', 'files', 'python'] as const;
export const aiCapabilities = [
  'metrics.read',
  'files.read',
  'files.create',
  'commands.execute',
  'http.send',
  'agent.manage',
  'agent.hosting',
  'agent.relay',
] as const;
export const aiProviderSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(80),
    url: z
      .string()
      .url()
      .max(2048)
      .refine((value) => {
        const u = new URL(value);
        return (
          !u.username &&
          !u.password &&
          !u.search &&
          !u.hash &&
          (u.protocol === 'https:' ||
            (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)))
        );
      }, 'Use HTTPS or a loopback HTTP endpoint, without embedded credentials'),
    model: z.string().trim().min(1).max(200),
    runBudget:z.object({minutes:z.number().int().min(1).max(240),contextBytes:z.number().int().min(10000).max(20000000),noProgress:z.number().int().min(2).max(20)}).optional(),
    extension: z.object({id:z.string().regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/),model:z.string().min(1).max(300)}).strict().optional(),
  })
  .strict();
export type AiProvider = z.infer<typeof aiProviderSchema> & { hasKey: boolean };
export const aiPermissionSchema = z
  .object({
    location: z.enum(aiLocations),
    providerId: z.string().uuid().nullable(),
    profiles: z.array(z.string().uuid()).max(1000),
    groups: z.array(z.string().max(100)).max(1000),
    capabilities: z.array(z.enum(aiCapabilities)),
  })
  .strict();
export const aiPolicySchema = z
  .object({
    application: z.array(
      z.enum([
        'connections.read',
        'connections.open',
        'agents.manage',
        'goals.manage',
        'events.manage',
        'web.search',
        'http.use',
        'ai.providers.manage',
        'wechat.read',
        'wechat.send',
        'wechat.payments.receive',
        'wechat.contacts.manage',
      ]),
    ),
    allMachines: z.boolean(),
    profiles: z.array(z.string().uuid()).max(1000),
    groups: z.array(z.string().max(100)).max(1000),
    capabilities: z.array(z.enum(aiCapabilities)),
    overrides: z
      .array(
        z
          .object({ profileId: z.string().uuid(), capabilities: z.array(z.enum(aiCapabilities)) })
          .strict(),
      )
      .max(1000),
  })
  .strict();
export type AiPolicy = z.infer<typeof aiPolicySchema>;
export const emptyAiPolicy = (): AiPolicy => ({
  application: [],
  allMachines: false,
  profiles: [],
  groups: [],
  capabilities: [],
  overrides: [],
});
export type AiPermission = z.infer<typeof aiPermissionSchema>;
export type AiLocation = (typeof aiLocations)[number];
export type AiMode = 'review' | 'restricted' | 'allow';
export type AiMessage = {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  time: number;
  eventGenerated?: boolean;
  tool?: { name: string; input: string; output: string; target?: string };
};
export type AiThread = {
  checkpoint?: import('./agent-continuity').AgentCheckpoint;
  contextSummary?: string;
  contextThrough?: number;
  execution?: {
    id: string;
    sessionId: string;
    input: string;
    output: string;
    state: 'running' | 'finished' | 'error';
  };
  id: string;
  title: string;
  location: AiLocation;
  providerId: string;
  extensionModel?: string;
  sessionId?: string;
  target?: string;
  mode: AiMode;
  parentId?: string;
  permissionCeiling?: AiPolicy;
  boundIdentity?: string;
  goal?: import('./ai-work').AiGoal;
  messages: AiMessage[];
  state: 'idle' | 'running' | 'approval' | 'error';
  error?: string;
  pending?: { id: string; tool: string; arguments: string; reason: string; target?: string };
};
export interface AiSnapshot {
  providers: AiProvider[];
  policy: AiPolicy;
  extractionProviderId: string | null;
  textProviderIds?: { translate: string | null; compose: string | null };
  permissions: AiPermission[];
  threads: AiThread[];
}
export interface AiBridge {
  aiEventsSnapshot(): Promise<import('./ai-events').AiEventSnapshot & {error?:string;subscriptions:{id:string;name:string;source:string}[]}>;
  aiEventSave(rule:import('./ai-events').AiEventRule):Promise<import('./ai-events').AiEventRule>;
  aiEventRemove(id:string):Promise<void>;
  aiEventListen(input:{source?:string;targets:string[];leaseSeconds:number}):Promise<unknown>;
  aiGoalSave(id: string, input: import('./ai-work').GoalInput): Promise<void>;
  aiGoalAction(
    id: string,
    action: 'pause' | 'resume' | 'run' | 'remove',
    sessionId?: string,
  ): Promise<void>;
  onAiProvidersChanged(listener: () => void): () => void;
  onAiThread(listener: (thread: AiThread) => void): () => void;
  aiProviderTest(
    provider: z.infer<typeof aiProviderSchema>,
    key?: string,
  ): Promise<{ elapsedMs: number; firstTokenMs: number | null; streaming: boolean }>;
  aiText(input: import('./ai-text').TextRequest): Promise<import('./ai-text').TextResult>;
  aiTextProviderSave(kind: 'translate' | 'compose', id: string | null): Promise<void>;
  onAiConnection(
    listener: (value: { sessionId: string; profile: import('./contracts').Profile }) => void,
  ): () => void;
  onMinimalHover(listener: (hovered: boolean) => void): () => void;
  aiExtractConnection(
    text: string,
    providerId?: string,
  ): Promise<import('./connection-extraction').ExtractedConnection>;
  aiPolicySave(policy: AiPolicy): Promise<void>;
  aiExtractionProviderSave(id: string | null): Promise<void>;
  aiSnapshot(): Promise<AiSnapshot>;
  aiProviderSave(provider: z.infer<typeof aiProviderSchema>, key?: string): Promise<void>;
  aiExtensionCall(id:string,action:string,input?:unknown):Promise<unknown>;
  aiProviderDelete(id: string): Promise<void>;
  aiPermissionSave(permission: AiPermission): Promise<void>;
  aiThreadCreate(
    location: AiLocation,
    providerId: string,
    mode: AiMode,
    sessionId?: string,
    extensionModel?: string,
  ): Promise<AiThread>;
  aiThreadDelete(id: string): Promise<void>;
  aiSend(id: string, text: string): Promise<void>;
  aiApprove(id: string, requestId: string, allow: boolean): Promise<void>;
  aiStop(id: string): Promise<void>;
  aiMode(id: string, mode: AiMode): Promise<void>;
}
