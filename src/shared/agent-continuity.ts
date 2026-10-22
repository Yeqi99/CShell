import { z } from 'zod';

export const checkpointSchema = z.object({
  objective: z.string().max(32000),
  constraints: z.array(z.string().max(2000)).max(30),
  decisions: z.array(z.string().max(2000)).max(30),
  completed: z.array(z.string().max(2000)).max(40),
  remaining: z.array(z.string().max(2000)).max(40),
  files: z.array(z.string().max(2000)).max(100),
  verification: z.array(z.string().max(2000)).max(40),
  unknown: z.array(z.string().max(2000)).max(40),
});
export type TaskMemory = z.infer<typeof checkpointSchema>;
export type AgentCheckpoint = {
  phase: string;
  updatedAt: number;
  pending?: { tool: string; input: string };
  lastResult?: string;
  recoveryRequired?: boolean;
  memory?: TaskMemory;
};
