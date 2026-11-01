import {z} from 'zod';
export const portableCapabilitiesSchema=z.array(z.object({id:z.string().min(1).max(100),version:z.string().max(80),manifestSha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict()).max(100).refine(items=>new Set(items.map(x=>x.id)).size===items.length,'Duplicate capability selection');
