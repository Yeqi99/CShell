import { z } from 'zod';
export const aiImageReference = z
  .object({
    id: z.string().uuid(),
    mimeType: z.literal('image/jpeg'),
    width: z.number().int().positive().max(1920),
    height: z.number().int().positive().max(1920),
    target: z.string().max(200),
    frameId: z.string().max(100),
    time: z.number().finite(),
  })
  .strict();
export type AiImageReference = z.infer<typeof aiImageReference>;
