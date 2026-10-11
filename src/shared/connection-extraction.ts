import { z } from 'zod';
// Only implemented connection form adapters participate. Future providers register
// their own schemas; model output never creates new providers or executable actions.
export const extractedConnectionSchema = z
  .object({
    providerId: z.literal('cshell.ssh'),
    fields: z
      .object({
        name: z.string().trim().max(255).optional(),
        host: z
          .string()
          .trim()
          .min(1)
          .max(255)
          .refine((s) => !/[\s\x00-\x1f]/.test(s))
          .optional(),
        port: z.number().int().min(1).max(65535).optional(),
        username: z
          .string()
          .trim()
          .min(1)
          .max(128)
          .refine((s) => !/[\r\n\0]/.test(s))
          .optional(),
        auth: z.enum(['password', 'key']).optional(),
        password: z.string().max(16000).optional(),
        group: z.string().trim().max(100).optional(),
      })
      .strict()
      .refine((fields) => !!fields.host, 'No SSH host found'),
  })
  .strict();
export type ExtractedConnection = z.infer<typeof extractedConnectionSchema>;
