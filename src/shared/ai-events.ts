import { z } from 'zod';

const id = z.string().min(1).max(160);
export const aiEventRuleSchema = z.object({
  id: z.string().uuid(), name: z.string().trim().min(1).max(80),
  enabled: z.boolean().default(false), source: id, eventType: id,
  subscriptionId: id.optional(), threadId: z.string().uuid(), bindingKey: z.string().max(64).optional(),
  prompt: z.string().trim().min(1).max(8000),
  filter: z.object({
    conversationIds: z.array(id).max(100).default([]), senderIds: z.array(id).max(100).default([]),
    privateOnly: z.boolean().default(false), excludeSelf: z.boolean().default(true),
  }).strict().default({ conversationIds: [], senderIds: [], privateOnly: false, excludeSelf: true }),
  cooldownSeconds: z.number().int().min(0).max(86400).default(30),
  maxRunsPerHour: z.number().int().min(1).max(60).default(6),
  maxRunsPerDay: z.number().int().min(1).max(200).default(30),
  reservedTokensPerRun: z.number().int().min(1024).max(128000).default(32768),
  maxModelCalls: z.number().int().min(1).max(4).default(2),
  maxReservedTokensPerDay: z.number().int().min(256).max(1000000).default(131072),
}).strict();
export type AiEventRule = z.infer<typeof aiEventRuleSchema>;
export const aiPluginEventSchema = z.object({
  id, source: id, type: id, accountId: id, subscriptionId: id.optional(),
  senderId: id, conversationId: id, isSelf: z.boolean(), isGroup: z.boolean(),
  occurredAt: z.number().int().nonnegative(), payload: z.record(z.string(), z.unknown()),
}).strict();
export type AiPluginEvent = z.infer<typeof aiPluginEventSchema>;
export interface AiEventSource {
  id: string; name: string; eventTypes: { id: string; name: string }[];
  available: boolean; reason?: string;
}
export interface AiEventRun {
  id: string; ruleId: string; eventId: string; threadId: string; createdAt: number;
  startedAt?: number; finishedAt?: number;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'unknown' | 'skipped';
  reason?: string; reservedTokens: number;
}
export interface AiEventSnapshot { rules: AiEventRule[]; sources: AiEventSource[]; runs: AiEventRun[] }
