import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {aiEventRuleSchema,type AiEventRule} from '../shared/ai-events';
import type {ConnectionTool} from './connections/contracts';

export interface EventToolHost {
  snapshot(): {rules:AiEventRule[];[key:string]:unknown};
  save(rule:AiEventRule):Promise<unknown>;
  remove(id:string):Promise<unknown>;
}
export function aiEventTools(host:EventToolHost,threadId:string):ConnectionTool[]{
  const captured=host.snapshot().rules;
  const check=(id:string)=>{
    const old=captured.find(r=>r.id===id),current=host.snapshot().rules.find(r=>r.id===id);
    if(JSON.stringify(old)!==JSON.stringify(current))throw new Error('订阅已改变，请重新读取后操作');
    return current;
  };
  const saveInput=aiEventRuleSchema.omit({bindingKey:true,id:true,threadId:true}).extend({id:z.string().uuid().optional(),threadId:z.string().uuid().optional()});
  const tool=(name:string,description:string,input:z.ZodType,write:boolean,run:(args:any)=>Promise<unknown>):ConnectionTool=>({name,description,capability:'events.manage',input,needsReview:()=>write,invoke:async(args,signal)=>{signal.throwIfAborted();return JSON.stringify(await run(args));}});
  return [
    tool('ai_event_list','List saved event rules, sources, listener subscriptions, eligible AI threads and recent run results. Does not start listeners or grant permissions.',z.object({}).strict(),false,async()=>host.snapshot()),
    tool('ai_event_save','Create or replace an event subscription using a source/type and prompt. Omit id to create; omit threadId to use this conversation. For updates first list rules and supply the full desired configuration. Enabled rules require authorized source and target. Does not grant permissions or start a source listener. Budgets, cooldown and deduplication remain enforced.',saveInput,true,async args=>{const id=args.id??randomUUID();check(id);return host.save(aiEventRuleSchema.parse({...args,id,threadId:args.threadId??threadId}));}),
    tool('ai_event_set_enabled','Enable or pause an existing event subscription. Pausing cancels queued and active runs. Enabling revalidates the target and source permissions.',z.object({id:z.string().uuid(),enabled:z.boolean()}).strict(),true,async args=>{const rule=check(args.id);if(!rule)throw new Error('订阅不存在');return host.save({...rule,enabled:args.enabled});}),
    tool('ai_event_remove','Delete an event subscription and cancel its queued or active runs. Does not delete conversations or source listeners.',z.object({id:z.string().uuid()}).strict(),true,async args=>{if(!check(args.id))throw new Error('订阅不存在');await host.remove(args.id);return {removed:true,id:args.id};}),
  ];
}
