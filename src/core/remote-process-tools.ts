import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { AgentCall } from '../shared/agent';
import type { ConnectionTool } from './connections/contracts';

const contract = z.object({ type:z.literal('object'),properties:z.record(z.string(),z.unknown()).optional() }).passthrough();
const processTool = z.object({
  process:z.literal(true),packageId:z.string().regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/),toolId:z.string().regex(/^[a-z][a-z0-9_.-]{0,99}$/),
  packageDigest:z.string().regex(/^[a-f0-9]{64}$/),description:z.string().max(1000),permissions:z.array(z.string().max(100)).max(64),
  inputSchema:contract,outputSchema:contract,
}).passthrough();
type RemoteProcessTool=z.infer<typeof processTool>;
function contracts(value:unknown): RemoteProcessTool[] {
  if(!Array.isArray(value)||value.length>500||Buffer.byteLength(JSON.stringify(value))>2*1024*1024)throw Error('Invalid remote capability catalog');
  const result:RemoteProcessTool[]=[];
  for(const raw of value){const parsed=processTool.safeParse(raw);if(!parsed.success)continue;const tool=parsed.data;
    if(tool.packageId.startsWith('cshell.')||tool.packageId.startsWith('cagent.')||!tool.permissions.includes('extension.execute'))continue;
    if(result.some(item=>item.packageId===tool.packageId&&item.toolId===tool.toolId))throw Error('Duplicate remote process tool');
    result.push(tool);
  }
  return result;
}
/** Only used after device authentication. Concrete schemas enter the existing machine policy. */
export async function remoteProcessTools(call:(input:AgentCall,signal:AbortSignal)=>Promise<unknown>,signal:AbortSignal):Promise<ConnectionTool[]> {
  const catalog=contracts(await call({method:'packages.tools'},signal));
  return catalog.flatMap(tool=>{
    let input:z.ZodType,output:z.ZodType;
    try{input=z.fromJSONSchema(tool.inputSchema as Parameters<typeof z.fromJSONSchema>[0]);output=z.fromJSONSchema(tool.outputSchema as Parameters<typeof z.fromJSONSchema>[0]);}catch{return [];}
    const revision=JSON.stringify(tool);
    return [{name:`extension_${createHash('sha256').update(tool.packageId+':'+tool.toolId).digest('hex').slice(0,24)}`,capability:'commands.execute',
      description:`Custom process ${tool.packageId}/${tool.toolId} on this authenticated CAgent host. ${tool.description}`,
      input,jsonOutput:output,needsReview:()=>true,conflictDomain:()=>`extension:${tool.packageId}`,
      invoke:async(args:unknown,abort:AbortSignal,_out?:unknown,guard?:()=>void)=>{
        abort.throwIfAborted();guard?.();
        const current=contracts(await call({method:'packages.tools'},abort)).find(item=>item.packageId===tool.packageId&&item.toolId===tool.toolId);
        if(!current||JSON.stringify(current)!==revision)throw Error('Remote extension changed or authorization was revoked; reconnect to refresh its contract');
        guard?.();abort.throwIfAborted();
        const result=await call({method:'packages.invoke',params:{packageId:tool.packageId,toolId:tool.toolId,args:input.parse(args)}},abort);
        return JSON.stringify(output.parse(result));
      }}];
  });
}
