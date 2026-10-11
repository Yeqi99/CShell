import { z } from 'zod';

// Data-only protocol. Validation does not install code or grant any permission.
const name = z.string().regex(/^[a-z][a-z0-9_.-]{1,99}$/);
const schema = z.record(z.string(), z.unknown());
export const providerContributionSchema = z
  .object({
    protocol: z.literal(1),
    id: z.string().regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    hostApi: z.literal(1),
    configuration: schema,
    // Names only: secret values remain in host credential storage.
    secretFields: z.array(name).max(32),
    capabilities: z.array(name).max(128),
    tools: z
      .array(
        z
          .object({
            name: name,
            inputSchema: schema,
            capability: name,
            risk: z.enum(['read', 'write', 'destructive']),
          })
          .strict(),
      )
      .max(128),
    views: z
      .array(z.object({ id: name, title: z.string().max(80), capability: name }).strict())
      .max(32),
  })
  .strict()
  .superRefine((value, ctx) => {
    const tools = new Set<string>();
    for (const tool of value.tools) {
      if (tools.has(tool.name) || !value.capabilities.includes(tool.capability))
        ctx.addIssue({ code: 'custom', message: 'Duplicate tool or undeclared capability' });
      tools.add(tool.name);
    }
    for (const view of value.views)
      if (!value.capabilities.includes(view.capability))
        ctx.addIssue({ code: 'custom', message: 'View requires undeclared capability' });
  });
export type ProviderContribution = z.infer<typeof providerContributionSchema>;

/** Client discovery envelope; authenticated identity is established out of band by the host. */
export const clientCapabilitiesSchema = z
  .object({
    protocol: z.literal(1),
    deviceId: z.string().uuid(),
    generation: z.number().int().nonnegative(),
    platform: z.string().min(1).max(80),
    capabilities: z
      .array(
        z
          .object({ id: name, version: z.number().int().positive(), tools: z.array(name).max(128) })
          .strict(),
      )
      .max(128),
  })
  .strict();
