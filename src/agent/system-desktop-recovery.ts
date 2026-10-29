import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
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
/** --probe initializes the capture source but never acquires a frame. */
export function describeDisplayProbe(value: unknown) {
  const probe = z
    .object({
      display: z
        .object({ width: z.number().int().positive(), height: z.number().int().positive() })
        .optional(),
    })
    .safeParse(value);
  const display = probe.success ? probe.data.display : undefined;
  return {
    displayDetected: !!display,
    actualFrameVerified: false as const,
    ...(display ? { displayWidth: display.width, displayHeight: display.height } : {}),
  };
}
export function nativeConsoleRecovery(executable: string) {
  const run = async (args: string[]) => {
    const { stdout } = await promisify(execFile)(executable, args, {
      windowsHide: true,
      timeout: 15000,
      maxBuffer: 16384,
    });
    const value = JSON.parse(stdout.replace(/^\uFEFF/, ''));
    if (value.error) throw new Error(String(value.error));
    return value;
  };
  return {
    inspect: async () => consoleRecoveryStateSchema.parse(await run(['--recovery-plan'])),
    display: async () => {
      try {
        const info = await run(['--probe']);
        return describeDisplayProbe(info);
      } catch {
        return describeDisplayProbe(undefined);
      }
    },
    execute: async (state: ConsoleRecoveryState) =>
      z
        .object({
          accepted: z.boolean(),
          confirmed: z.boolean(),
          errorCode: z.number().int().nonnegative(),
          sessionId: z.number().int(),
          consoleSessionId: z.number().int(),
        })
        .strict()
        .parse(
          await run(['--recover-console', String(state.sessionId), String(state.consoleSessionId)]),
        ),
  };
}
export function consoleRecoveryEligible(state: ConsoleRecoveryState) {
  return (
    state.canAttempt &&
    state.reason === 'READY_TO_ATTEMPT' &&
    state.sourceUnlocked &&
    !state.consoleOccupied &&
    state.protocol === 2 &&
    state.sourceState === 0 &&
    state.consoleSessionId > 0 &&
    state.consoleSessionId !== 0xffffffff &&
    state.consoleSessionId !== state.sessionId
  );
}
/** One-use, caller-bound plans. Both layers recheck the exact session; never retry a migration. */
export class ConsoleRecovery {
  private plans = new Map<string, { owner: string; value: ConsoleRecoveryPlan }>();
  private busy = false;
  constructor(
    private backend: ReturnType<typeof nativeConsoleRecovery>,
    private authorize: (owner: string) => boolean,
    private now = Date.now,
  ) {}
  private allowed(owner: string) {
    if (!this.authorize(owner)) throw new Error('转为独立远控需要当前机器管理与桌面控制权限');
  }
  async plan(owner: string) {
    this.allowed(owner);
    for (const [id, p] of this.plans) if (p.value.expires < this.now()) this.plans.delete(id);
    if (this.plans.size >= 16) throw new Error('恢复计划过多，请稍后重试');
    const state = await this.backend.inspect();
    const display = await this.backend.display();
    this.allowed(owner);
    const value = {
      ...state,
      canAttempt: consoleRecoveryEligible(state),
      ...display,
      id: randomUUID(),
      expires: this.now() + 120000,
    };
    this.plans.set(value.id, { owner, value });
    return value;
  }
  async execute(owner: string, input: unknown) {
    this.allowed(owner);
    const { planId } = z
      .object({ planId: z.string().uuid(), confirm: z.literal(true) })
      .strict()
      .parse(input);
    const plan = this.plans.get(planId);
    if (!plan || plan.owner !== owner || plan.value.expires < this.now())
      throw new Error('恢复计划已失效，请重新检查');
    if (this.busy) throw new Error('恢复正在执行');
    this.plans.delete(planId);
    this.busy = true;
    try {
      if (!plan.value.canAttempt) throw new Error('此状态不支持转为独立远控');
      const fresh = await this.backend.inspect();
      if (
        !consoleRecoveryEligible(fresh) ||
        fresh.sessionId !== plan.value.sessionId ||
        fresh.consoleSessionId !== plan.value.consoleSessionId
      )
        throw new Error('Windows 会话已变化，请重新检查');
      this.allowed(owner);
      const result = await this.backend.execute(fresh);
      return {
        ...result,
        confirmed:
          result.accepted &&
          result.confirmed &&
          result.sessionId === fresh.sessionId &&
          result.consoleSessionId === fresh.sessionId,
      };
    } finally {
      this.busy = false;
    }
  }
}
