import {z} from 'zod';
const requestId=z.string().regex(/^[A-Za-z0-9_-]{8,100}$/);
const prefix=z.string().min(3).max(32);
const record={name:z.string().min(1).max(253),type:z.enum(['A','AAAA','CNAME','TXT','MX']),content:z.string().min(1).max(2048),ttl:z.number().int().refine(v=>v===1||v>=60&&v<=86400).optional(),priority:z.number().int().min(0).max(65535).optional(),requestId};
export const memberDomainCommandSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('claim'),prefix,requestId}).strict(),
 z.object({action:z.literal('rename'),prefix,requestId}).strict(),
 z.object({action:z.literal('create'),prefix,...record}).strict(),
 z.object({action:z.literal('update'),id:z.string().uuid(),...record}).strict(),
 z.object({action:z.literal('delete'),id:z.string().uuid(),requestId}).strict(),
]);
export type MemberDomainCommand=z.infer<typeof memberDomainCommandSchema>;
export const memberDomainStateSchema=z.object({
 namespace:z.string().nullable(),membershipActive:z.boolean(),renameAvailable:z.boolean(),nextRenameAt:z.number().nullable(),timezone:z.literal('Asia/Shanghai'),recordLimit:z.number().int().positive(),
 domains:z.array(z.object({prefix:z.string(),domain:z.string(),retired:z.boolean()})).max(1000),
 records:z.array(z.object({id:z.string().uuid(),prefix:z.string(),name:z.string(),type:z.enum(['A','AAAA','CNAME','TXT','MX']),content:z.string(),ttl:z.number().int(),proxied:z.literal(false),priority:z.number().int().optional()})).max(10000),
 capabilities:z.object({read:z.boolean(),claim:z.boolean(),rename:z.boolean(),writeDns:z.boolean(),deleteDns:z.boolean()}),
});
export type MemberDomainState=z.infer<typeof memberDomainStateSchema>;
