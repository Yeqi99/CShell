import {z} from 'zod';
import {ClassroomTasks,ClassroomTaskFailure} from '../core/classroom-tasks';
import type {ClientProvider} from '../core/client/provider';
import type {ClassroomTaskTarget} from '../shared/classroom-tasks';
import {setTimeout as delay} from 'node:timers/promises';
export function registerClassroomTasks(handle:(name:string,fn:(...args:any[])=>any)=>void,provider:ClientProvider,enabled:()=>boolean,models:{classroomModels():{id:string;label:string}[];classroomModel(id:string):{endpoint:string;model:string;key:string}}){
 const guard=()=>{if(!enabled())throw Error('请先启用机房扩展');};
 const call=(id:string,method:any,params?:unknown,signal?:AbortSignal)=>{guard();return provider.call(id,{method,params},signal);};
 const resolve=async(id:string):Promise<ClassroomTaskTarget>=>{guard();const device=provider.list().find(d=>d.deviceId===id);if(!device)throw Error('机器未配对');const status=await call(id,'client.status') as any;if(status.deviceId!==id)throw Error('机器身份改变');const methods=new Set(status.methods??[]);return {id,identity:device.fingerprint,label:device.name,platform:status.platform??'',capabilities:([['script','management.script.start'],['environment','environment.save'],['model','assistant.model.configure'],['application','applications.plan']] as const).filter(([,method])=>methods.has(method)).map(([kind])=>kind)};};
 const taskQueue=new ClassroomTasks({resolve,prepare:async(target,action)=>{
   if(action.kind==='model'){const value=models.classroomModel(action.baseId);return {summary:`将智能体基座改为 ${value.model}；密钥经认证加密通道发送并在目标加密保存，保留授权，运行中任务需先完成。`,opaque:value};}
   if(action.kind==='environment')return {summary:`更新 ${Object.keys(action.variables).length} 个环境变量，仅对CAgent随后启动的进程生效；不改系统全局变量。`};
   if(action.kind==='script'){const shells=await call(target.id,'agent.shells') as any[];if(!shells.some(s=>s.shell===action.shell))throw Error('Shell不存在');return {summary:`以当前CAgent用户运行 ${action.shell} 脚本；最长1小时。不会绕过UAC，安装脚本需提供静默参数及结果校验。`};}
   const plan=await call(target.id,'applications.plan',{app:action.appId}) as any;return {summary:`安装 ${plan.app}：${plan.warning??''}`,opaque:{id:plan.id},expiresAt:plan.expires};
 },execute:async(target,action,opaque,signal)=>{
   if(action.kind==='model'){if(JSON.stringify(models.classroomModel(action.baseId))!==JSON.stringify(opaque))throw new ClassroomTaskFailure('基座已改变，请重新准备');await call(target.id,'assistant.model.configure',opaque,signal);return {message:'基座已更新，授权保持不变'};}
   if(action.kind==='environment'){await call(target.id,'environment.save',{variables:action.variables},signal);return {message:'环境已保存，将用于新启动的CAgent终端和脚本'};}
   const script=action.kind==='script';
   signal.throwIfAborted();
   const job=script?await call(target.id,'management.script.start',{shell:action.shell,command:action.script,timeoutMs:3600000}) as any:opaque as any;
   const cancel=()=>{void provider.call(target.id,{method:script?'management.script.cancel':'applications.cancel',params:{id:job.id}}).catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
   try{if(signal.aborted){cancel();signal.throwIfAborted();}if(!script)await call(target.id,'applications.install',{id:job.id,confirm:true},signal);for(;;){signal.throwIfAborted();const state=await call(target.id,script?'management.script.status':'applications.status',{id:job.id,...(script?{waitMs:1000}: {})},signal) as any;if(['completed','succeeded'].includes(state.state))return {message:script?'脚本执行结束，退出码0；请以脚本内的检查确认安装结果':'应用安装完成'};if(['failed','cancelled','interrupted'].includes(state.state))throw new ClassroomTaskFailure('远端任务未成功完成');await delay(1000,undefined,{signal});}}finally{signal.removeEventListener('abort',cancel);}
 }});
 handle('classroom:tasks-targets',async()=>{guard();const result:ClassroomTaskTarget[]=[];const ids=provider.list().map(d=>d.deviceId);let i=0;await Promise.all(Array.from({length:4},async()=>{while(i<ids.length){const id=ids[i++];try{result.push(await resolve(id));}catch{}}}));return result;});
 handle('classroom:tasks-choices',async()=>{guard();const apps=new Set<string>();let i=0;const devices=provider.list();await Promise.all(Array.from({length:4},async()=>{while(i<devices.length){const d=devices[i++];try{const result=await call(d.deviceId,'applications.list') as any;if(result.enabled)for(const item of result.applications??[])if(typeof item.id==='string')apps.add(item.id);}catch{}}}));return {models:models.classroomModels(),applications:[...apps].sort().map(id=>({id,label:id}))};});
 handle('classroom:tasks-prepare',(input)=>{guard();return taskQueue.prepare(input);});
 handle('classroom:tasks-execute',(id)=>{guard();return taskQueue.execute(z.string().uuid().parse(id));});
 handle('classroom:tasks-list',()=>{guard();return taskQueue.list();});
 handle('classroom:tasks-cancel',(id)=>{guard();return taskQueue.cancel(z.string().uuid().parse(id));});
 return taskQueue;
}
