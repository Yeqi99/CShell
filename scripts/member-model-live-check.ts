import {createRequire} from 'node:module';
import {writeFile,mkdir} from 'node:fs/promises';
import {readAiResponse} from '../src/core/ai-response';
const require=createRequire(import.meta.url);
const session=require('../.local/member-model-session.cjs')().session;
if(!session?.token)throw Error('当前账号未登录');
const headers={Authorization:'Bearer '+session.token,'Content-Type':'application/json'};
const base='https://shell.canp.ai/api/v1/models';
const catalog=await fetch(base,{headers,signal:AbortSignal.timeout(20000)});
if(!catalog.ok)throw Error('模型目录 HTTP '+catalog.status);
const models=(await catalog.json()).models.filter((m:any)=>m.id.startsWith('pool-'));
console.log(JSON.stringify(models.map((m:any)=>({id:m.id,name:m.name}))));
if(process.argv.includes('--catalog'))process.exit(0);
await mkdir('test-results',{recursive:true});
const results:any[]=[];
for(const model of models){
 const started=Date.now();let first=0,updates=0,chars=0;const samples:string[]=[];
 const record:any={name:model.name,id:model.id};
 console.log('START '+model.name);
 try {
  const response=await fetch(base+'/chat/completions',{method:'POST',headers,signal:AbortSignal.timeout(180000),body:JSON.stringify({model:model.id,stream:true,max_tokens:4096,messages:[{role:'system',content:'请使用简体中文回答。这是纯文本显示测试，不调用工具。'},{role:'user',content:'请用四个简短段落说明流式输出的优点，每段约40字。最后单独写：会员基座验证完成。'}]})});
  record.http=response.status;record.contentType=response.headers.get('content-type');
  if(!response.ok){let value:any;try{value=await response.json();}catch{};throw Error('HTTP '+response.status+' '+(value?.error??''));}
  const reply=await readAiResponse(response,text=>{if(!first)first=Date.now();updates++;chars=text.length;if(samples.length<3)samples.push(text);},()=>{},usage=>{record.usage=usage;});
  record.elapsedMs=Date.now()-started;record.firstTextMs=first?first-started:null;record.updates=updates;record.characters=(reply.content??'').length;
  record.answer=reply.content;record.reasoningCharacters=reply.reasoning_content?.length??0;
  record.streamed=updates>1;record.chinese=/[\u4e00-\u9fff]/.test(reply.content??'');record.complete=(reply.content??'').includes('会员基座验证完成');
  record.pass=record.streamed&&record.chinese&&record.complete&&!/<think>|We need answer|Need to respond/.test(reply.content??'');
 }catch(error){record.error=String(error);record.elapsedMs=Date.now()-started;record.updates=updates;record.characters=chars;record.pass=false;}
 results.push(record);await writeFile('test-results/member-model-live.json',JSON.stringify({at:new Date().toISOString(),results},null,2));
 const {answer,...safe}=record;console.log(JSON.stringify(safe));
}
console.log('COMPLETE '+results.filter(r=>r.pass).length+'/'+results.length);
