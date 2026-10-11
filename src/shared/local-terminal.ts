import { z } from 'zod';
export const localShellSchema = z.union([
  z.enum(['cmd', 'powershell']),
  z.string().regex(/^wsl:[^\0\r\n]{1,120}$/),
]);
export type LocalShell = z.infer<typeof localShellSchema>;
export const localEnvironmentSchema = z
  .array(
    z
      .object({
        name: z
          .string()
          .min(1)
          .max(255)
          .regex(/^[^=\0\r\n]+$/),
        value: z
          .string()
          .max(32767)
          .refine((v) => !v.includes('\0')),
      })
      .strict(),
  )
  .max(256)
  .refine(
    (rows) => new Set(rows.map((r) => r.name.toUpperCase())).size === rows.length,
    '环境变量名称不能重复',
  );
export type LocalEnvironment = z.infer<typeof localEnvironmentSchema>;
export interface LocalTerminalBridge {
  wslDistributions(): Promise<{ available: boolean; distributions: string[]; error?: string }>;
  localTerminal(shell: LocalShell): Promise<{ sessionId: string; name: string }>;
  localEnvironment(): Promise<{
    supported: boolean;
    overrides: LocalEnvironment;
    inherited: LocalEnvironment;
  }>;
  saveLocalEnvironment(rows: LocalEnvironment): Promise<void>;
}
