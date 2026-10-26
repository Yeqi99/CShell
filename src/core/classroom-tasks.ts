import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {classroomActionSchema,type ClassroomAction,type ClassroomTaskTarget,type ClassroomTaskPlan,type ClassroomTaskSnapshot} from '../shared/classroom-tasks';
export interface ClassroomTaskHost {
 /** Resolve from host-owned authenticated connections, never from a discovery announcement. */
 resolve(id:string):Promise<ClassroomTaskTarget>;
 /** Read-only check and target-specific plan. Throw if unsupported or unauthorized. Do not execute. */
 prepare(target:ClassroomTaskTarget,action:ClassroomAction):Promise<{summary:string;opaque?:unknown;expiresAt?:number}>;
 /** Must recheck permissions. Return a safe status summary; never return secrets or raw script output. */
 execute(target:ClassroomTaskTarget,action:ClassroomAction,opaque:unknown,signal:AbortSignal):Promise<{message:string}>;
}
type Prepared={plan:ClassroomTaskPlan;action:ClassroomAction;entries:Map<string,{target:ClassroomTaskTarget;opaque:unknown;expiresAt?:number}>};
type Task={snapshot:ClassroomTaskSnapshot;abort:AbortController};
/** Only a confirmed remote terminal failure may be labelled failed after dispatch. */
export class ClassroomTaskFailure extends Error {}
const inputSchema=z.object({targetIds:z.array(z.string().min(1).max(200)).min(1).max(128).refine(ids=>new Set(ids).size===ids.length),action:classroomActionSchema}).strict();
/** Bounded, in-memory, one-use plans. No automatic retry or replay after cancellation/restart. */
export class ClassroomTasks {
 private plans=new Map<string,Prepared>();private tasks=new Map<string,Task>();private generation=0;private preparing=0;
 constructor(private host:ClassroomTaskHost,private concurrency=4){if(!Number.isInteger(concurrency)||concurrency<1||concurrency>8)throw Error('Invalid concurrency');}
 get hasActiveWork(){return this.preparing>0||[...this.tasks.values()].some(t=>!t.snapshot.finishedAt);}
 async prepare(raw:unknown):Promise<ClassroomTaskPlan>{
  this.preparing++;
  try{return await this.prepareNow(raw);}finally{this.preparing--;}
 }
 private async prepareNow(raw:unknown):Promise<ClassroomTaskPlan>{
  const generation=this.generation,input=inputSchema.parse(raw);for(const [id,p]of this.plans)if(p.plan.expiresAt<Date.now())this.plans.delete(id);
  if(this.plans.size>=16)throw Error('待确认计划过多，请稍后重试');
  const plan:ClassroomTaskPlan={id:randomUUID(),kind:input.action.kind,expiresAt:0,targets:[]};
  const entries:Prepared['entries']=new Map();
  let next=0;
  await Promise.all(Array.from({length:Math.min(4,input.targetIds.length)},async()=>{
   for(;;){if(generation!==this.generation)return;const index=next++;if(index>=input.targetIds.length)return;
    const id=input.targetIds[index];let label=id,identity='';
    try{
     const target=await this.host.resolve(id);if(generation!==this.generation)return;
     label=target.label;identity=target.identity;if(target.id!==id||!identity||!target.capabilities.includes(input.action.kind))throw Error();
     const p=await this.host.prepare(target,structuredClone(input.action));
     if(p.expiresAt!==undefined&&(!Number.isFinite(p.expiresAt)||p.expiresAt<=Date.now()))throw Error('Target plan expired');
     entries.set(id,{target:structuredClone(target),opaque:p.opaque,expiresAt:p.expiresAt});
     plan.targets[index]={id,label,identity,summary:p.summary.slice(0,4000)};
    }catch{plan.targets[index]={id,label,identity,summary:'',error:'无法准备：连接、身份、权限或目标能力不满足要求。'};}
   }
  }));
  if(generation!==this.generation)throw Error('扩展已关闭，计划已丢弃');
  // The user gets the full confirmation window after all network checks finish.
  // A remote application's own shorter expiry is kept separately, never extended.
  plan.expiresAt=Date.now()+120000;
  this.plans.set(plan.id,{plan,action:input.action,entries});return structuredClone(plan);
 }
 execute(planId:string):ClassroomTaskSnapshot{
  const prepared=this.plans.get(planId);if(!prepared)throw Error('计划不存在或已使用');
  if(prepared.plan.expiresAt<Date.now())throw Error('计划已过期，请重新检查');
  if([...this.tasks.values()].some(t=>!t.snapshot.finishedAt))throw Error('已有批量任务运行中，请等待完成');
  this.plans.delete(planId);
  for(const[id,t]of this.tasks)if(this.tasks.size>=32&&t.snapshot.finishedAt)this.tasks.delete(id);
  const snapshot:ClassroomTaskSnapshot={id:randomUUID(),kind:prepared.action.kind,createdAt:Date.now(),cancelRequested:false,rows:prepared.plan.targets.map(t=>({targetId:t.id,label:t.label,state:t.error?'failed':'queued',message:t.error||'等待执行'}))};
  const task={snapshot,abort:new AbortController()};this.tasks.set(snapshot.id,task);void this.run(task,prepared);return structuredClone(snapshot);
 }
 private async run(task:Task,prepared:Prepared){
  const queue=task.snapshot.rows.filter(r=>r.state==='queued');
  await Promise.all(Array.from({length:this.concurrency},async()=>{for(;;){const row=queue.shift();if(!row)return;if(task.abort.signal.aborted){row.state='cancelled';row.message='尚未执行，已取消';row.finishedAt=Date.now();continue;}
   const entry=prepared.entries.get(row.targetId)!;row.state='running';row.startedAt=Date.now();row.message='正在核对目标身份与执行权限';let dispatched=false;
   try{const current=await this.host.resolve(row.targetId);if(current.id!==entry.target.id||current.identity!==entry.target.identity||!current.capabilities.includes(prepared.action.kind))throw Error('Identity changed');if(entry.expiresAt!==undefined&&entry.expiresAt<=Date.now())throw Error('Target plan expired');task.abort.signal.throwIfAborted();dispatched=true;row.message='执行中';const result=await this.host.execute(current,structuredClone(prepared.action),entry.opaque,task.abort.signal);row.state='succeeded';row.message=result.message.slice(0,4000)||'执行完成';}
   catch(error){row.state=task.abort.signal.aborted?(dispatched?'unknown':'cancelled'):(dispatched&&!(error instanceof ClassroomTaskFailure)?'unknown':'failed');row.message=task.abort.signal.aborted?(dispatched?'已请求停止；远端最终结果未知，请检查目标，未自动重试。':'尚未执行，已取消'):row.state==='unknown'?'连接或执行响应中断；远端最终结果未知，请检查目标，未自动重试。':'执行失败；请检查目标连接、权限和任务记录。';}
   finally{row.finishedAt=Date.now();}
  }}));task.snapshot.finishedAt=Date.now();prepared.entries.clear();
 }
 list(){return structuredClone([...this.tasks.values()].map(t=>t.snapshot));}
 cancel(id:string){const task=this.tasks.get(id);if(!task)throw Error('任务不存在');if(!task.snapshot.finishedAt){task.snapshot.cancelRequested=true;task.abort.abort();}return structuredClone(task.snapshot);}
 dispose(){this.generation++;this.plans.clear();for(const task of this.tasks.values())if(!task.snapshot.finishedAt){task.snapshot.cancelRequested=true;task.abort.abort();}}
}
