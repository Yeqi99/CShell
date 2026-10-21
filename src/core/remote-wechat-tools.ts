import {z} from 'zod';
import {WechatService} from './wechat';
import type {ConnectionTool} from './connections/contracts';
import type {AgentCall} from '../shared/agent';
import {localWechatPaymentTools} from '../shared/wechat';

/** Only trusted, locally known contracts; remote metadata cannot lower review. */
export async function remoteWechatTools(call:(input:AgentCall,signal:AbortSignal)=>Promise<unknown>,signal:AbortSignal):Promise<ConnectionTool[]>{
 const catalog=z.array(z.object({packageId:z.string(),id:z.string(),permissions:z.array(z.string()),sideEffect:z.boolean()})).max(128).parse(await call({method:'packages.tools'},signal));
 const known=new WechatService('',{plugins:()=>[]},{enabled:()=>true}).tools();
 return known.flatMap(tool=>{
   // These adapters depend on this desktop's installed bridge and shared journal.
   if((localWechatPaymentTools as readonly string[]).includes(tool.name))return [];
   const remote=catalog.find(item=>item.packageId==='cagent.wechat'&&item.id===tool.name&&item.permissions.includes(tool.capability));
   if(!remote)return [];
   return [{...tool,name:'remote_'+tool.name,description:'Operate WeChat on the BOUND CAgent machine, never this controller. '+tool.description,
     needsReview:(args:unknown)=>remote.sideEffect||tool.needsReview(args),
     invoke:async(args:unknown,abort:AbortSignal)=>JSON.stringify(await call({method:'packages.invoke',params:{packageId:'cagent.wechat',toolId:tool.name,args:tool.input.parse(args)}},abort))}];
 });
}
