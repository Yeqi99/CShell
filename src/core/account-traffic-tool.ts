import {z} from 'zod';
import type {ConnectionTool} from './connections/contracts';
import {accountTrafficSchema} from '../shared/account-traffic';
export function accountTrafficTool(host:{accountId:()=>string|undefined;traffic:()=>Promise<unknown>}):ConnectionTool{
 return{name:'account_traffic_read',capability:'account.read',description:'Read the signed-in account current UTC-month relay and MCP usage, reservations, configured allowance and remaining bytes. Null limits preserve existing entitlement. Does not change limits or expose internal costs, credentials or other accounts.',input:z.object({}).strict(),jsonOutput:accountTrafficSchema,needsReview:()=>false,invoke:async(input,signal,_out,guard)=>{z.object({}).strict().parse(input);const account=host.accountId();if(!account)throw Error('Sign in first');guard?.();signal.throwIfAborted();const result=accountTrafficSchema.parse(await host.traffic());signal.throwIfAborted();guard?.();if(host.accountId()!==account)throw Error('Account changed');return JSON.stringify(result);}};
}
