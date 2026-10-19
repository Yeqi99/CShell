// OpenCode protocol adapters. The CShell host continues to use its generic chat contract.
export type Family='chat'|'responses'|'anthropic'|'google';
export function family(model:string):Family|null {
  if(/^jev(?:-|$)/.test(model))return null; // Typed decision API, not a conversational model.
  if(/^gemini-/.test(model))return 'google';
  if(/^(gpt-|grok-|muse-)/.test(model))return 'responses';
  if(/^claude-|^qwen.*(?:flash|plus)/.test(model))return 'anthropic';
  if(/^(deepseek-|glm-|kimi-|minimax-|mimo-|qwen.*max|longcat-|step-|hy\d|beam-|space-|nemotron-|big-pickle|gpt-oss)/.test(model))return 'chat';
  return null;
}
export function encodeRequest(kind:Family,b:any){
  if(kind==='chat')return b;
  const tools=b.tools??[],messages=b.messages??[];
  if(kind==='responses')return {model:b.model,stream:b.stream,store:false,...(b.max_tokens?{max_output_tokens:b.max_tokens}:{}),
    input:messages.flatMap((m:any)=>m.role==='tool'?[{type:'function_call_output',call_id:m.tool_call_id,output:m.content}]:[
      ...(m.content?[{role:m.role,content:m.content}]:[]),...(m.tool_calls??[]).map((c:any)=>({type:'function_call',call_id:c.id,name:c.function.name,arguments:c.function.arguments}))]),
    ...(tools.length?{tools:tools.map((t:any)=>({type:'function',...t.function})),tool_choice:'auto'}:{})};
  if(kind==='anthropic'){
    const converted:any[]=[];
    for(const m of messages.filter((m:any)=>m.role!=='system')){
      const role=m.role==='assistant'?'assistant':'user';
      const content=m.role==='tool'?[{type:'tool_result',tool_use_id:m.tool_call_id,content:m.content}]:[
        ...(m.content?[{type:'text',text:m.content}]:[]),...(m.tool_calls??[]).map((c:any)=>({type:'tool_use',id:c.id,name:c.function.name,input:JSON.parse(c.function.arguments)}))];
      if(!content.length)continue;
      if(converted.at(-1)?.role===role)converted.at(-1).content.push(...content);else converted.push({role,content});
    }
    return {model:b.model,stream:b.stream,max_tokens:b.max_tokens??8192,system:messages.filter((m:any)=>m.role==='system').map((m:any)=>m.content).join('\n'),messages:converted,
      ...(tools.length?{tools:tools.map((t:any)=>({name:t.function.name,description:t.function.description,input_schema:t.function.parameters}))}:{})};
  }
  const names=new Map<string,string>();
  for(const m of messages)for(const c of m.tool_calls??[])names.set(c.id,c.function.name);
  return {systemInstruction:{parts:messages.filter((m:any)=>m.role==='system').map((m:any)=>({text:m.content}))},
    contents:messages.filter((m:any)=>m.role!=='system').map((m:any)=>({role:m.role==='assistant'?'model':'user',parts:m.role==='tool'?[{functionResponse:{name:names.get(m.tool_call_id)??m.tool_call_id,response:{result:m.content}}}]:[
      ...(m.content?[{text:m.content}]:[]),...(m.tool_calls??[]).map((c:any)=>({functionCall:{name:c.function.name,args:JSON.parse(c.function.arguments)},...(c.providerData?{thoughtSignature:c.providerData}:{})}))]})),
    ...(b.max_tokens?{generationConfig:{maxOutputTokens:b.max_tokens}}:{}),...(tools.length?{tools:[{functionDeclarations:tools.map((t:any)=>({name:t.function.name,description:t.function.description,parameters:t.function.parameters}))}]}:{})};
}
/** Normalize both JSON and SSE without buffering an entire streamed completion. */
export function normalizeResponse(response:Response,kind:Family,stream:boolean):Response {
  if(!response.ok||kind==='chat')return response;
  let content='',done=false,finishReason='stop';const calls=new Map<number,any>();
  const consume=(v:any):any[]=>{
    if(v.error||v.type==='error'||v.type==='response.failed')throw Error('OpenCode 返回模型错误');
    const out:any[]=[];
    const text=(s:string)=>{if(s){content+=s;out.push({choices:[{index:0,delta:{content:s}}]});}};
    const tool=(i:number,id:string,name:string,args:string,signature?:string)=>{
      if(i<0||i>=16)throw Error('模型工具调用过多');
      const c=calls.get(i)??{id:'',type:'function',function:{name:'',arguments:''}};
      if(id)c.id=id;if(name)c.function.name=name;c.function.arguments+=args;if(signature)c.providerData=signature;calls.set(i,c);
      out.push({choices:[{index:0,delta:{tool_calls:[{index:i,...(id?{id,type:'function'}:{}),function:{...(name?{name}:{}),...(args?{arguments:args}:{})},...(signature?{providerData:signature}:{})}]}}]});
    };
    const finish=(reason?:string)=>{if(done)return;done=true;finishReason=reason==='max_tokens'||reason==='MAX_TOKENS'||reason==='max_output_tokens'?'length':calls.size?'tool_calls':'stop';out.push({choices:[{index:0,delta:{},finish_reason:finishReason}]});};
    if(kind==='anthropic'){
      if(v.type==='content_block_start'&&v.content_block.type==='tool_use')tool(v.index,v.content_block.id,v.content_block.name,'');
      if(v.type==='content_block_delta'){if(v.delta.type==='text_delta')text(v.delta.text);if(v.delta.type==='input_json_delta')tool(v.index,'','',v.delta.partial_json);}
      if(v.type==='message_delta'&&v.delta.stop_reason)finish(v.delta.stop_reason);
      if(v.type==='message_stop')finish();
      if(v.content){for(const [i,p] of v.content.entries()){if(p.type==='text')text(p.text);if(p.type==='tool_use')tool(i,p.id,p.name,JSON.stringify(p.input));}finish(v.stop_reason);}
    }else if(kind==='responses'){
      if(v.type==='response.output_text.delta')text(v.delta);
      if(v.type==='response.output_item.added'&&v.item.type==='function_call')tool(v.output_index,v.item.call_id,v.item.name,'');
      if(v.type==='response.function_call_arguments.delta')tool(v.output_index,'','',v.delta);
      if(v.type==='response.incomplete')finish(v.response?.incomplete_details?.reason??'max_output_tokens');
      if(v.type==='response.completed')finish();
      if(!v.type&&v.output){for(const [i,p] of v.output.entries()){if(p.type==='message')for(const t of p.content??[])if(t.type==='output_text')text(t.text);if(p.type==='function_call')tool(i,p.call_id,p.name,p.arguments);}finish(v.incomplete_details?.reason);}
    }else{
      const c=v.candidates?.[0];if(v.promptFeedback?.blockReason)throw Error('模型拒绝了请求');
      for(const p of c?.content?.parts??[]){if(p.text&&!p.thought)text(p.text);if(p.functionCall){const i=calls.size;tool(i,`call_${i}`,p.functionCall.name,JSON.stringify(p.functionCall.args??{}),p.thoughtSignature);}}
      if(c?.finishReason){if(!['STOP','MAX_TOKENS'].includes(c.finishReason))throw Error('模型未正常完成');finish(c.finishReason);}
    }
    return out;
  };
  const encoder=new TextEncoder();const reader=response.body?.getReader();
  if(!reader)return response;
  let bytes=0,pending='';const decoder=new TextDecoder();const sse=response.headers.get('content-type')?.includes('text/event-stream');
  return new Response(new ReadableStream({async start(controller){try{
    const emit=(v:any)=>{for(const chunk of consume(v))if(stream)controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));};
    for(;;){const next=await reader.read();if(next.value){bytes+=next.value.length;if(bytes>2_000_000)throw Error('模型响应过大');pending+=decoder.decode(next.value,{stream:true});if(stream)controller.enqueue(encoder.encode(': activity\n\n'));}
      if(sse){let m;while((m=/\r?\n\r?\n/.exec(pending))){const block=pending.slice(0,m.index);pending=pending.slice(m.index+m[0].length);const data=block.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trim()).join('\n');if(data&&data!=='[DONE]')emit(JSON.parse(data));}}
      if(next.done){pending+=decoder.decode();if(!sse)emit(JSON.parse(pending));break;}if(done)break;
    }
    if(!done)throw Error('模型响应中断，未重试');
    if(stream)controller.enqueue(encoder.encode('data: [DONE]\n\n'));else controller.enqueue(encoder.encode(JSON.stringify({choices:[{message:{content,tool_calls:[...calls.values()]},finish_reason:finishReason}]})));
    controller.close();
  }catch(e){controller.error(e);}finally{await reader.cancel().catch(()=>{});}},cancel(){return reader.cancel();}}),{headers:{'Content-Type':stream?'text/event-stream':'application/json'}});
}
