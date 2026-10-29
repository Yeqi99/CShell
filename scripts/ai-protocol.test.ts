import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchAiProtocol} from '../src/core/ai-protocol';
import {readAiResponse} from '../src/core/ai-response';
const event=(value:any)=>'data: '+JSON.stringify(value)+'\n\n';
test('Terra uses Responses, preserves images and tool history, returns complete tool calls',async()=>{
 let request:any;
 const transport:typeof fetch=async(url,init)=>{assert.equal(String(url),'https://api.openai.com/v1/responses');request=JSON.parse(String(init?.body));return new Response(event({type:'response.output_text.delta',delta:'Ready'})+event({type:'response.completed',response:{status:'completed',output:[{type:'function_call',call_id:'call1',name:'inspect',arguments:'{}'}]}}),{headers:{'content-type':'text/event-stream'}})};
 const result=await fetchAiProtocol(transport,'https://api.openai.com/v1/chat/completions',{body:JSON.stringify({model:'gpt-6.1-terra',stream:true,messages:[{role:'user',content:[{type:'image_url',image_url:{url:'data:image/png;base64,AAAA'}}]},{role:'assistant',tool_calls:[{id:'old',function:{name:'inspect',arguments:'{}'}}]},{role:'tool',tool_call_id:'old',content:'ok'}],tools:[{type:'function',function:{name:'inspect',parameters:{type:'object'}}}]})});
 assert.equal((await readAiResponse(result,()=>{})).tool_calls?.[0].id,'call1');assert.equal(request.store,false);assert.equal(request.input[0].content[0].type,'input_image');assert.equal(request.input[2].call_id,'old');assert.equal(request.tools[0].strict,false);
});
test('truncated response cannot execute a partially generated call',async()=>{
 const response=await fetchAiProtocol(async()=>new Response(event({type:'response.function_call_arguments.delta',delta:'{}'})),'https://api.openai.com/v1/responses/chat/completions',{body:JSON.stringify({model:'gpt-6.1-terra',stream:true,messages:[]})});
 await assert.rejects(readAiResponse(response,()=>{}),/中断/);
});
test('third party chat transport is unchanged',async()=>{let called='';const original=new Response('{}');const response=await fetchAiProtocol(async(url)=>{called=String(url);return original},'https://example.com/v1/chat/completions',{body:JSON.stringify({model:'gpt-6.1-terra'})});assert.equal(called,'https://example.com/v1/chat/completions');assert.equal(response,original)});
