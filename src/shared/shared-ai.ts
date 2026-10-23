import { z } from 'zod';
import { aiPolicySchema, aiProviderSchema } from './ai';
import { habitsSchema } from './account-memory';
export const sharedAiConfigSchema = z
  .object({
    providers: z.array(aiProviderSchema.extend({ key: z.string().max(16000) })).max(200),
    extractionProviderId: z.string().uuid().nullable(),
    textProviderIds: z
      .object({ translate: z.string().uuid().nullable(), compose: z.string().uuid().nullable() })
      .strict(),
    habits: habitsSchema.optional(),
    policy: aiPolicySchema.optional(),
  })
  .strict();
export type SharedAiConfig = z.infer<typeof sharedAiConfigSchema>;
export const emptySharedAi = (): SharedAiConfig => ({
  providers: [],
  extractionProviderId: null,
  textProviderIds: { translate: null, compose: null },
  habits: [],
});
