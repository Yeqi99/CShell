import {z} from 'zod';
const bytes=z.number().int().nonnegative();
export const accountTrafficSchema=z.object({period:z.string().regex(/^\d{4}-\d{2}$/),timezone:z.literal('UTC'),periodStartsAt:z.number(),periodEndsAt:z.number(),updatedAt:z.number(),channels:z.array(z.object({category:z.enum(['relay','mcp']),ingressBytes:bytes,egressBytes:bytes,usedBytes:bytes,reservedBytes:bytes,baseLimitBytes:bytes.nullable(),addonBytes:bytes,limitBytes:bytes.nullable(),remainingBytes:bytes.nullable()})).length(2)});
export type AccountTraffic=z.infer<typeof accountTrafficSchema>;
