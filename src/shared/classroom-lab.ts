import type {ClassroomAction} from './classroom-tasks';
import {classroomProxyAction} from './classroom-proxy';
export interface ClassroomLabDraft {compute:'CPU'|'CUDA';cudaIndex:'cu126'|'cu128';root:string;proxy:string;apply:boolean}
export const defaultClassroomLabDraft:ClassroomLabDraft={compute:'CPU',cudaIndex:'cu128',root:'',proxy:'',apply:false};
export function classroomLabAction(source:string,draft:ClassroomLabDraft):Extract<ClassroomAction,{kind:'script'}>{
 if(!['CPU','CUDA'].includes(draft.compute)||!['cu126','cu128'].includes(draft.cudaIndex)||typeof draft.apply!=='boolean')throw Error('教学环境选项无效。');
 if(typeof draft.root!=='string'||draft.root.length>512||/[\x00-\x1f\x7f]/.test(draft.root))throw Error('安装目录无效。');
 const quote=(value:string)=>"'"+value.replace(/'/g,"''")+"'";
 const proxy=draft.proxy?classroomProxyAction({mode:'set',url:draft.proxy,noProxy:''}).variables.HTTP_PROXY:'';
 const args=[`-Compute ${draft.compute}`,`-CudaIndex ${draft.cudaIndex}`];
 if(draft.root.trim())args.push(`-Root ${quote(draft.root.trim())}`);
 if(proxy)args.push(`-Proxy ${quote(proxy)}`);
 if(draft.apply)args.push('-Apply');
 const script=`& {\n${source}\n} ${args.join(' ')}`;
 if(script.length>16384)throw Error('教学环境模板超出任务大小限制。');
 return {kind:'script',shell:'powershell',script};
}
/** Never persist proxy, commands, secrets or the destructive Apply choice. */
export function classroomLabSavedDraft(value:unknown):ClassroomLabDraft{
 const v=value&&typeof value==='object'?value as Partial<ClassroomLabDraft>:{};
 return {...defaultClassroomLabDraft,compute:v.compute==='CUDA'?'CUDA':'CPU',cudaIndex:v.cudaIndex==='cu126'?'cu126':'cu128',root:typeof v.root==='string'&&v.root.length<=512&&!/[\x00-\x1f\x7f]/.test(v.root)?v.root:''};
}
