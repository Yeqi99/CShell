import { z } from 'zod';

export const agentAppId = z.enum([
  'mysql', 'milvus', 'redis',
  'browser',
  'git',
  'nodejs',
  'python',
  'vscode',
  '7zip',
  'curl',
  'jq',
  'ripgrep',
  'ffmpeg',
]);
export const appPolicySchema = z
  .object({
    enabled: z.boolean().default(true),
    controllers: z
      .array(z.union([z.literal('*'),z.string().regex(/^[a-f0-9:]{64,95}$/i)]))
      .max(32)
      .default(['*']),
  })
  .strict();
const port = z.number().int().min(1).max(65535);
export const appPlanInput = z.object({ app: agentAppId }).strict();
export const appTaskInput = z.object({ id: z.string().uuid() }).strict();
export const appInstallInput = z
  .object({ id: z.string().uuid(), confirm: z.literal(true), port: port.optional() })
  .strict();
export const appTaskSchema = z
  .object({
    id: z.string().uuid(),
    app: agentAppId,
    port: port.optional(),
    platform: z.string(),
    manager: z.string(),
    executable: z.string(),
    args: z.array(z.string()),
    expires: z.number(),
    state: z.enum(['planned', 'running', 'completed', 'failed', 'interrupted']),
    logs: z.string(),
    exitCode: z.number().nullable().optional(),
    warning: z.string(),
  })
  .strict();
export const appCatalogSchema = z
  .object({
    platform: z.string(),
    manager: z.string().nullable(),
    enabled: z.boolean(),
    applications: z.array(z.object({ id: agentAppId, package: z.string(), unavailable: z.string().optional() }).strict()),
  })
  .strict();
