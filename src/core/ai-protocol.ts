import { parseAiJson } from './ai-response';

/** Preserve third-party Chat Completions; official GPT-6 tools use Responses. */
export async function fetchAiProtocol(transport: typeof fetch, url: string, init: RequestInit): Promise<Response> {
  const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
  const endpoint = new URL(url);
  const explicit = /\/responses(?:\/chat\/completions)?\/?$/.test(endpoint.pathname);
  if (!explicit && !(endpoint.hostname === 'api.openai.com' && /^gpt-6(?:[.-]|$)/.test(body?.model ?? ''))) return transport(url, init);
  endpoint.pathname = endpoint.pathname.replace(/\/(?:responses\/)?chat\/completions\/?$/, '/responses');
  const input: any[] = [];
  for (const message of body.messages ?? []) {
    if (message.role === 'tool') { input.push({type:'function_call_output',call_id:message.tool_call_id,output:message.content ?? ''}); continue; }
    if (message.content) input.push({role:message.role,content:typeof message.content === 'string' ? message.content : message.content.map((part:any) => {
      if(part.type==='text') return {type:message.role==='assistant'?'output_text':'input_text',text:part.text};
      if(part.type==='image_url') return {type:'input_image',image_url:part.image_url.url,detail:part.image_url.detail??'auto'};
      throw new Error('Responses 不支持此消息类型');
    })});
    for(const call of message.tool_calls??[]) input.push({type:'function_call',call_id:call.id,name:call.function.name,arguments:call.function.arguments});
  }
  const request={model:body.model,input,store:false,stream:!!body.stream,
    ...(body.tools?{tools:body.tools.map((tool:any)=>({type:'function',...tool.function,strict:false})),tool_choice:body.tool_choice??'auto'}:{}),
    ...(body.max_tokens?{max_output_tokens:body.max_tokens}:{})};
  const response=await transport(endpoint.href,{...init,body:JSON.stringify(request)});
  if(!response.ok)return response;
  const reply=(value:any)=>{
    if(value.status!=='completed')throw new Error('Responses 响应未完成，未执行工具调用');
    const output=value.output??[];
    return {content:output.filter((item:any)=>item.type==='message').flatMap((item:any)=>item.content??[]).filter((part:any)=>part.type==='output_text').map((part:any)=>part.text).join(''),
      tool_calls:output.filter((item:any)=>item.type==='function_call').map((item:any)=>({id:item.call_id,type:'function',function:{name:item.name,arguments:item.arguments}}))};
  };
  if(!body.stream)return Response.json({choices:[{message:reply(await response.json())}]});
  if(!response.body)throw new Error('Responses 返回空响应');
  const reader=response.body.getReader(),decoder=new TextDecoder(),encoder=new TextEncoder();
  let pending='',size=0,completed=false;
  return new Response(new ReadableStream({
    async pull(controller){
      try{
        while(!completed){
          const chunk=await reader.read();
          pending+=decoder.decode(chunk.value,{stream:!chunk.done});size+=chunk.value?.byteLength??0;
          if(size>2_000_000)throw new Error('Responses 响应过大');
          let match;
          while((match=/\r?\n\r?\n/.exec(pending))){
            const block=pending.slice(0,match.index);pending=pending.slice(match.index+match[0].length);
            const data=block.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
            if(!data)continue;
            const event=parseAiJson(data,'sse');
            if(['error','response.failed','response.incomplete'].includes(event.type))throw new Error('Responses 响应失败或未完成，未执行工具调用');
            if(event.type==='response.output_text.delta')controller.enqueue(encoder.encode('data: '+JSON.stringify({choices:[{index:0,delta:{content:event.delta}}]})+'\n\n'));
            if(event.type==='response.completed'){
              const result=reply(event.response);
              controller.enqueue(encoder.encode('data: '+JSON.stringify({choices:[{index:0,delta:{tool_calls:result.tool_calls.map((call:any,index:number)=>({...call,index}))},finish_reason:'stop'}]})+'\n\n'));
              completed=true;break;
            }
          }
          if(completed){await reader.cancel();controller.close();return;}
          if(chunk.done)throw new Error('Responses 连接中断，未执行工具调用');
          // Expose reasoning activity as a harmless SSE comment to the idle timer.
          controller.enqueue(encoder.encode(': activity\n\n'));return;
        }
      }catch(error){await reader.cancel().catch(()=>{});controller.error(error);}
    },cancel(reason){return reader.cancel(reason);}
  }),{headers:{'Content-Type':'text/event-stream'}});
}
