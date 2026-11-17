import {z} from 'zod';
import type {ConnectionTool} from './connections/contracts';
export const spendingInput=z.object({action:z.enum(['catalog','quote','activate']),request:z.string().uuid().optional(),kind:z.enum(['rent','pro','expand','cpu','memory','renew']).optional(),plan:z.string().max(40).optional(),id:z.string().uuid().optional(),units:z.number().int().min(1).max(100).optional(),included:z.boolean().optional()}).strict();
export const spendingDescription='在当前账号已开启智能体点数授权时，按任务需要选购服务。catalog 查询真实套餐与余额，quote 使用新的 UUID request 报价，activate 使用同一个 request 开通并扣点。rent 需要 plan；cpu、memory、expand 或 renew 需要实例 id。仅在确有需要时购买。响应未知时必须复用原 request，不能另开订单。';
export function spendingTool(invoke:(input:unknown,signal:AbortSignal)=>Promise<unknown>):ConnectionTool {
  return {name:'account_services',capability:'agents.manage',description:spendingDescription,input:spendingInput,needsReview:()=>false,conflictDomain:()=>'account-spending',invoke:async(input,signal)=>JSON.stringify(await invoke(spendingInput.parse(input),signal))};
}
