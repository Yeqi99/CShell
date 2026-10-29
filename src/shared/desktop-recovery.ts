import { z } from 'zod';
export const consoleRecoveryStateSchema = z
  .object({
    sessionId: z.number().int().positive(),
    consoleSessionId: z.number().int().nonnegative(),
    sourceState: z.number().int(),
    protocol: z.number().int(),
    sourceUnlocked: z.boolean(),
    consoleOccupied: z.boolean(),
    canAttempt: z.boolean(),
    reason: z.string().max(100),
  })
  .strict();
export type ConsoleRecoveryState = z.infer<typeof consoleRecoveryStateSchema>;
export type ConsoleRecoveryPlan = ConsoleRecoveryState & {
  id: string;
  expires: number;
  displayDetected: boolean;
  actualFrameVerified: false;
  displayWidth?: number;
  displayHeight?: number;
};
export type ConsoleRecoveryResult = {
  accepted: boolean;
  confirmed: boolean;
  errorCode: number;
  sessionId: number;
  consoleSessionId: number;
};
