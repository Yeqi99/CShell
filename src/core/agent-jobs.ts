import {randomUUID} from 'node:crypto';
import {z} from 'zod';
export const jobQuery=z.object({id:z.string().uuid(),offset:z.number().int().min(0).default(0),waitMs:z.number().int().min(0).max(30000).default(0)}).strict();
type Job={id:string;owner:string;state:'running'|'completed'|'failed'|'cancelled';output:string;dropped:number;abort:AbortController;done:Promise<void>};
/** Background operations remain bound to the owning run and its live authorization. */
export class AgentJobs{
 private jobs=new Map<string,Job>();
 async start(owner:string,signal:AbortSignal,execute:(signal:AbortSignal,output:(s:string)=>void)=>Promise<string>){
  if([...this.jobs.values()].filter(j=>j.state==='running').length>=4)throw Error('后台任务并发已达 4 个');
  for(const [id,j] of this.jobs)if(j.state!=='running'&&this.jobs.size>=32)this.jobs.delete(id);
  const abort=new AbortController(),id=randomUUID();const j:Job={id,owner,state:'running',output:'',dropped:0,abort,done:Promise.resolve()};this.jobs.set(id,j);
  const append=(s:string)=>{j.output+=s;if(j.output.length>128000){j.dropped+=j.output.length-128000;j.output=j.output.slice(-128000);}};
  j.done=Promise.resolve().then(()=>execute(AbortSignal.any([signal,abort.signal]),append)).then(result=>{if(result)append('\n'+result);j.state=signal.aborted||abort.signal.aborted?'cancelled':'completed';},e=>{append('\n'+String(e.message));j.state=signal.aborted||abort.signal.aborted?'cancelled':'failed';});
  return {id,state:j.state};
 }
 async query(owner:string,input:unknown,stop=false){const q=jobQuery.parse(input);const j=this.jobs.get(q.id);if(!j||j.owner!==owner)throw Error('后台任务不存在或不属于此会话');if(stop)j.abort.abort(new Error('后台任务已请求停止，须检查实际退出结果'));
  if(q.waitMs&&j.state==='running'){let timer:ReturnType<typeof setTimeout>|undefined;await Promise.race([j.done,new Promise<void>(r=>timer=setTimeout(r,q.waitMs))]);clearTimeout(timer);}
  const start=Math.max(q.offset,j.dropped),output=j.output.slice(start-j.dropped,start-j.dropped+16000);return {id:j.id,state:j.state,output,nextOffset:start+output.length,gap:q.offset<j.dropped};
 }
 list(owner:string){return [...this.jobs.values()].filter(j=>j.owner===owner).map(({id,state})=>({id,state}));}
 async stopOwner(owner:string){const jobs=[...this.jobs.values()].filter(j=>j.owner===owner);for(const j of jobs)if(j.state==='running')j.abort.abort();await Promise.all(jobs.map(j=>j.done));}
}
