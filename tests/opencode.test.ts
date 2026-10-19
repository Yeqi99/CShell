import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {OpenCodeExtension,quotaWindows} from '../src/extensions/opencode/service';
import {encodeRequest,normalizeResponse,family} from '../src/extensions/opencode/protocol';
import {readAiResponse} from '../src/core/ai-response';
import {AiService} from '../src/core/ai';
import {Store} from '../src/core/store';
import {ConnectionRegistry} from '../src/core/connections/registry';
import {randomUUID} from 'node:crypto';
test('generic host routes managed provider chat, probe and text through extension transport',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'extension-host-'));const store=new Store(directory,{encrypt:async s=>Buffer.from(s).toString('base64'),decrypt:async s=>Buffer.from(s,'base64').toString()});const ai=new AiService(directory,store,new ConnectionRegistry(()=>undefined));let enabled=true,calls=0;
 ai.providerExtensions.register({id:'test.models',call:async()=>null,resolve:async()=>{if(!enabled)throw Error('disabled');return {url:'https://model-extension.invalid',model:'fixture',key:'',transport:async()=>{calls++;return Response.json({choices:[{message:{content:'OK'}}]});}};}});
 try{await store.load();await ai.load();const p={id:randomUUID(),name:'fixture',url:'https://model-extension.invalid',model:'fixture',extension:{id:'test.models',model:'fixture'}};await ai.saveProvider(p);await ai.setTextProvider('translate',p.id);await ai.testProvider(p);assert.equal((await ai.text({kind:'translate',text:'hello'})).text,'OK');const t=await ai.create('workspace',p.id,'review');await ai.send(t.id,'hello');const end=Date.now()+3000;while(ai.snapshot().threads.find(v=>v.id===t.id)?.state==='running'&&Date.now()<end)await new Promise(r=>setTimeout(r,10));assert.equal(ai.snapshot().threads.find(v=>v.id===t.id)?.messages.at(-1)?.content,'OK');assert.ok(calls>=3);enabled=false;await assert.rejects(()=>ai.text({kind:'translate',text:'hello'}),/disabled/);}finally{ai.dispose();await ai.flush();await rm(directory,{recursive:true,force:true});}
});
test('extension credentials stay private, Go routes stay separate, disable blocks transport',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'opencode-test-'));let enabled=true;let saved:any;const requests:any[]=[];
 const network:typeof fetch=async(url,init)=>{requests.push({url:String(url),init});if(String(url).endsWith('/models'))return Response.json({data:[{id:'glm-5.3'},{id:'claude-haiku-5-5'},{id:'unknown-new-protocol'}]});return Response.json({choices:[{message:{content:'OK'}}]});};
 const host={directory,enabled:()=>enabled,encrypt:async(s:string)=>Buffer.from(s).toString('base64'),decrypt:async(s:string)=>Buffer.from(s,'base64').toString(),saveProvider:async(p:any)=>{saved=p;},open:async()=>{}};
 try{const e=new OpenCodeExtension(host,network);await e.load();await e.call('save',{key:'test-private-key',workspace:'https://opencode.ai/console/wrk_test/go'});const state=await e.call('status',{});assert.equal(JSON.stringify(state).includes('test-private-key'),false);await e.call('add',{tier:'go',model:'glm-5.3',name:'Go'});assert.equal(saved.extension.model,'go/glm-5.3');assert.equal(saved.key,undefined);
 const p=await e.resolve('go/glm-5.3','conversation-1');await p.transport(p.url,{body:JSON.stringify({model:p.model,messages:[],stream:false})});const last=requests.at(-1);assert.match(last.url,/\/inference\/go\/openai\/v1\/chat\/completions$/);assert.equal(last.init.headers['x-opencode-session'],'conversation-1');assert.equal(last.init.headers.Authorization,'Bearer test-private-key');assert.equal((await readFile(join(directory,'opencode.enc'),'utf8')).includes('test-private-key'),false);
 enabled=false;await assert.rejects(()=>p.transport(p.url,{body:'{}'}),/启用/);enabled=true;await assert.rejects(()=>e.resolve('go/unknown-new-protocol','test'),/协议/);const reload=new OpenCodeExtension(host,network);await reload.load();assert.equal((await reload.call('status',{})).hasKey,true);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('official quota windows are distinct from money and unknown format is unavailable',()=>{
 const result=quotaWindows({rollingUsage:{usagePercent:23,resetInSec:100},weeklyUsage:{usagePercent:50},monthlyUsage:{usagePercent:0}});assert.deepEqual(result.map(x=>x.usedPercent),[23,50,0]);assert.ok(result[0].resetAt);assert.deepEqual(quotaWindows({balance:20}),[]);assert.equal(family('jev-1.13'),null);
});
test('request adapters preserve tool results and Gemini thought signatures',()=>{
 const b={model:'test',stream:true,messages:[{role:'system',content:'system'},{role:'assistant',content:'',tool_calls:[{id:'c1',function:{name:'lookup',arguments:'{"x":1}'},providerData:'signed-thought'}]},{role:'tool',tool_call_id:'c1',content:'result'}],tools:[{type:'function',function:{name:'lookup',parameters:{type:'object'}}}]};
 assert.equal(encodeRequest('responses',b).input[2].type,'function_call_output');assert.equal(encodeRequest('anthropic',b).messages[1].content[0].tool_use_id,'c1');assert.equal(encodeRequest('google',b).contents[0].parts[0].thoughtSignature,'signed-thought');assert.equal(encodeRequest('google',b).contents[1].parts[0].functionResponse.name,'lookup');
});
test('Responses and Anthropic fragmented SSE normalize tool calls without fake completion',async()=>{
 for(const kind of ['responses','anthropic'] as const){const events=kind==='responses'?[{type:'response.output_text.delta',delta:'Hello'},{type:'response.output_item.added',output_index:0,item:{type:'function_call',call_id:'c1',name:'lookup'}},{type:'response.function_call_arguments.delta',output_index:0,delta:'{"x":1}'},{type:'response.completed'}]:[{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'Hello'}},{type:'content_block_start',index:1,content_block:{type:'tool_use',id:'c1',name:'lookup'}},{type:'content_block_delta',index:1,delta:{type:'input_json_delta',partial_json:'{"x":1}'}},{type:'message_delta',delta:{stop_reason:'tool_use'}}];
 const bytes=new TextEncoder().encode(events.map(e=>`data: ${JSON.stringify(e)}\n\n`).join(''));const body=new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=7)c.enqueue(bytes.slice(i,i+7));c.close();}});
 const parsed=await readAiResponse(normalizeResponse(new Response(body,{headers:{'content-type':'text/event-stream'}}),kind,true),()=>{});assert.equal(parsed.content,'Hello');assert.equal(parsed.tool_calls?.[0].function.arguments,'{"x":1}');}
 const truncated=new Response('data: {"type":"response.output_text.delta","delta":"partial"}\n\n',{headers:{'content-type':'text/event-stream'}});await assert.rejects(()=>readAiResponse(normalizeResponse(truncated,'responses',true),()=>{}),/中断/);
});
test('Gemini JSON preserves tool metadata in normalized contract',async()=>{
 const r=Response.json({candidates:[{content:{parts:[{functionCall:{name:'lookup',args:{x:1}},thoughtSignature:'signed-thought'}]},finishReason:'STOP'}]});const p=await readAiResponse(normalizeResponse(r,'google',false),()=>{});assert.equal(p.tool_calls?.[0].providerData,'signed-thought');
});
