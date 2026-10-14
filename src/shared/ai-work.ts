import { z } from 'zod';

export const goalInputSchema = z
  .object({
    objective: z.string().trim().min(1).max(8000),
    intervalMinutes: z.number().int().min(1).max(10080).default(15),
  })
  .strict();
export type GoalInput = z.input<typeof goalInputSchema>;
export type AiGoal = z.output<typeof goalInputSchema> & {
  state: 'active' | 'paused' | 'complete' | 'blocked';
  reason: string;
  nextRun?: number;
  lastRun?: number;
  runs: number;
  history: { time: number; status: string; summary: string }[];
};
export const goalStates = {
  active: '定期检查',
  paused: '已暂停',
  complete: '已达成',
  blocked: '缺少条件',
};
