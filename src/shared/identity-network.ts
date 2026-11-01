import {z} from 'zod';
export const identityEndpointSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('local')}).strict(),
 z.object({kind:z.literal('ssh'),id:z.string().uuid()}).strict(),
 z.object({kind:z.literal('agent'),id:z.string().uuid()}).strict(),
]);
export type IdentityEndpoint=z.infer<typeof identityEndpointSchema>;
export const identityRuleSchema=z.object({source:identityEndpointSchema,target:identityEndpointSchema}).strict();
export type IdentityRule=z.infer<typeof identityRuleSchema>;
export const identityRulesSchema=z.array(identityRuleSchema).max(100).superRefine((rules,ctx)=>{try{assertRules(rules);}catch(e){ctx.addIssue({code:'custom',message:e instanceof Error?e.message:'Invalid rules'});}});
export const identityKey=(e:IdentityEndpoint)=>e.kind==='local'?'local':e.kind+':'+e.id;
export function validateIdentityRules(input:unknown):IdentityRule[]{
 const rules=z.array(identityRuleSchema).max(100).parse(input);assertRules(rules);return rules;
}
function assertRules(rules:IdentityRule[]){const graph=new Map<string,string>();
 for(const r of rules){const key=identityKey(r.source);if(graph.has(key))throw Error('每台来源机器只能有一个出口');graph.set(key,identityKey(r.target));}
 for(const key of graph.keys()){const seen=new Set<string>();let next:string|undefined=key;while(next!==undefined){if(seen.has(next))throw Error('网络出口不能形成循环');seen.add(next);next=graph.get(next);}}
 return rules;
}
export type IdentityNetworkStatus={endpoints:{endpoint:IdentityEndpoint;name:string;available:boolean;reason?:string}[];rules:(IdentityRule&{state:'active'|'pending'|'failed';error?:string;proxy?:string})[];scope:'applications';pendingRemovals?:{source:IdentityEndpoint;error?:string}[];};
export type IdentityNetworkCommand={action:'list'}|{action:'save';rule:IdentityRule}|{action:'remove';source:IdentityEndpoint};
