import { z } from 'zod';
import { desktopQualitySchema, type DesktopVideoInfo } from './agent-desktop';

export const desktopViewStartSchema = z
  .object({
    id: z.string().uuid(),
    target: z.string().min(1).max(160),
    control: z.boolean().default(false),
    quality: desktopQualitySchema,
  })
  .strict();
export const desktopViewInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string().min(1).max(512).refine(v=>!v.includes('\0')) }).strict(),
  z.object({ kind: z.literal('secure-attention') }).strict(),
  z
    .object({ kind: z.literal('key'), code: z.number().int().min(1).max(511), down: z.boolean() })
    .strict(),
  z
    .object({
      kind: z.literal('button'),
      button: z.number().int().min(0).max(4),
      down: z.boolean(),
    })
    .strict(),
  z
    .object({ kind: z.literal('move'), x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
    .strict(),
  z
    .object({
      kind: z.literal('wheel'),
      delta: z.number().int().min(-32768).max(32767),
      horizontal: z.boolean().optional(),
    })
    .strict(),
]);
export type DesktopViewInput = z.infer<typeof desktopViewInputSchema>;
export type DesktopViewEvent = { id: string; generation?: number } & (
  | {
      type: 'state';
      state: 'reconnecting' | 'connected';
      attempt: number;
      delayMs: number;
      control: boolean;
      reason?: string;
    }
  | { type: 'config'; info: DesktopVideoInfo }
  | { type: 'frame'; sequence: string; timestamp: number; key: boolean; data: Uint8Array }
  | { type: 'closed'; reason: string }
  | { type: 'error'; message: string; recoverable?: boolean; resumed?: boolean }
);
export interface DesktopViewBridge {
  desktopViewStart(
    input: z.infer<typeof desktopViewStartSchema>,
  ): Promise<{ id: string; control: boolean; generation?: number }>;
  desktopViewStop(id: string): Promise<void>;
  desktopViewInput(id: string, event: DesktopViewInput, generation?: number): Promise<void>;
  desktopViewRelease(id: string, generation?: number): Promise<void>;
  desktopViewAck(
    id: string,
    sequence: string,
    decoded: boolean,
    decodeMs: number,
    generation?: number,
  ): Promise<void>;
  desktopViewQuality(
    id: string,
    quality: z.infer<typeof desktopQualitySchema>,
    generation?: number,
  ): Promise<void>;
  onDesktopViewEvent(listener: (event: DesktopViewEvent) => void): () => void;
}
