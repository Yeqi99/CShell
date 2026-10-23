import { z } from 'zod';
export const networkProbeSchema = z.object({
  host: z.string().trim().min(1).max(255).refine(value => !/[\s/\\@\0-\x1f]/.test(value), '目标地址格式无效'),
  port: z.number().int().min(1).max(65535),
  samples: z.number().int().min(1).max(8).default(5),
  timeoutMs: z.number().int().min(250).max(3000).default(2000),
}).strict();
export type NetworkProbeInput = z.infer<typeof networkProbeSchema>;
export type NetworkProbeResult = {
  method: 'tcp-connect'; host: string; port: number; startedAt: number;
  samples: { elapsedMs: number | null; error?: string }[];
  minimumMs: number | null; averageMs: number | null; maximumMs: number | null;
  failed: number;
};
const elapsed = z.number().finite().min(0).max(120000).nullable();
export const networkProbeResultSchema = z.object({
  method: z.literal('tcp-connect'), host: z.string().max(255), port: z.number().int().min(1).max(65535), startedAt: z.number().finite().min(0),
  samples: z.array(z.object({ elapsedMs: elapsed, error: z.string().max(200).optional() }).strict()).min(1).max(8),
  minimumMs: elapsed, averageMs: elapsed, maximumMs: elapsed, failed: z.number().int().min(0).max(8),
}).strict();
export type NetworkDiagnostics = { sources: { id: string; name: string }[]; targets: { id: string; name: string; host: string; port: number }[] };
