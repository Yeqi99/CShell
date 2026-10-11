import { z } from 'zod';
export const activityKinds = [
  'connection',
  'file',
  'transfer',
  'ai',
  'tool',
  'deployment',
] as const;
export const activitySchema = z
  .object({
    id: z.string().uuid(),
    time: z.number().int().nonnegative(),
    kind: z.enum(activityKinds),
    action: z.string().max(80),
    status: z.enum(['success', 'failed', 'cancelled']),
    provider: z.string().max(80),
    resource: z.string().max(128).optional(),
    duration: z.number().nonnegative().optional(),
    bytes: z.number().nonnegative().optional(),
  })
  .strict();
export type Activity = z.infer<typeof activitySchema>;
export interface ActivitySnapshot {
  enabled: boolean;
  since: number;
  events: Activity[];
  error?: string;
}
export interface ActivityBridge {
  activitySnapshot(): Promise<ActivitySnapshot>;
  activityEnable(enabled: boolean): Promise<void>;
  activityClear(): Promise<boolean>;
  activityExport(from: number, to: number, format: 'csv' | 'html'): Promise<boolean>;
}
