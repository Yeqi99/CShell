import { z } from 'zod';
export const networkInterfaceSchema = z
  .object({
    name: z.string(),
    rxBytes: z.number(),
    txBytes: z.number(),
    rxPackets: z.number(),
    txPackets: z.number(),
    rxErrors: z.number(),
    txErrors: z.number(),
    rxDropped: z.number(),
    txDropped: z.number(),
    receivePerSecond: z.number().nullable(),
    sendPerSecond: z.number().nullable(),
  })
  .strict();
export const networkMetricsSchema = z
  .object({
    status: z.enum(['sampling', 'ready', 'unavailable']),
    interfaces: z.array(networkInterfaceSchema),
    sampledAt: z.number(),
  })
  .strict();
export type NetworkMetrics = z.infer<typeof networkMetricsSchema>;
export interface ProcessNetworkSnapshot {
  status: 'ready' | 'missing-tool' | 'unavailable';
  entries: {
    pid: number;
    uid: number;
    name: string;
    receivePerSecond: number;
    sendPerSecond: number;
  }[];
  sampledAt: number;
}
