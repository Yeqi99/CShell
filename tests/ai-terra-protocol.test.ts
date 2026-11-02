import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fetchAiProtocol} from '../src/core/ai-protocol';
test('official Terra event budgets and tools use Responses parameters without unsupported chat limits',async()=>{
 let calls=0;
 const response=await fetchAiProtocol((async(url,init)=>{
  calls++;assert.equal(String(url),'https://api.openai.com/v1/responses');const body=JSON.parse(String(init?.body));
  assert.equal(body.model,'gpt-6.1-terra');assert.equal(body.max_output_tokens,512);assert.equal(body.max_tokens,undefined);assert.equal(body.temperature,undefined);assert.equal(body.store,false);
  assert.equal(body.tools[0].name,'inspect_fixture');assert.equal(body.tools[0].strict,false);
  return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'OK'}]}]});
 }) as typeof fetch,'https://api.openai.com/v1/chat/completions',{method:'POST',body:JSON.stringify({model:'gpt-6.1-terra',messages:[{role:'user',content:'fixture'}],max_tokens:512,stream:false,tools:[{type:'function',function:{name:'inspect_fixture',description:'fixture',parameters:{type:'object',properties:{}}}}]})});
 assert.equal((await response.json()).choices[0].message.content,'OK');assert.equal(calls,1);
});
test('third-party chat endpoint keeps its explicit protocol and is never retried as a paid model',async()=>{
 const original=JSON.stringify({model:'custom',messages:[],max_tokens:512});let calls=0;
 const response=await fetchAiProtocol((async(url,init)=>{calls++;assert.equal(String(url),'https://example.invalid/v1/chat/completions');assert.equal(init?.body,original);return new Response('',{status:400});}) as typeof fetch,'https://example.invalid/v1/chat/completions',{body:original});
 assert.equal(response.status,400);assert.equal(calls,1);
});
