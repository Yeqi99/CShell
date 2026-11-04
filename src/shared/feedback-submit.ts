import {feedbackSchema,redactFeedback} from './feedback';
export async function submitFeedback(input:unknown,transport:(input:string,init?:RequestInit)=>Promise<Response>){
 const body=feedbackSchema.parse(input);
 for(const key of ['message','contact','diagnostic'] as const)if(body[key])body[key]=redactFeedback(body[key]!);
 const response=await transport('https://shell.canp.ai/api/v1/feedback',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!response.ok){await response.body?.cancel();throw Error(response.status===429?'反馈提交较频繁，请稍后重试。':'反馈暂未送达，请保留内容后重试。');}
 const receipt=await response.json();if(receipt?.received!==true||receipt.id!==body.id)throw Error('反馈回执无效，请重试。');return {ok:true,id:body.id};
}
