import {createRequire} from 'node:module';
import {mkdir,writeFile,readFile,rename} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {CagentAssistant} from '../src/agent/assistant';
import {ClientVault} from '../src/core/client/identity';
import {requestAiReply} from '../src/core/ai-request';
import {knowledgeAdapter,knowledgeInputs} from '../src/agent/knowledge';
import {z} from 'zod';
const require=createRequire(import.meta.url),session=require('../.local/member-model-session.cjs')().session;
const base='https://shell.canp.ai/api',headers={Authorization:'Bearer '+session.token,'Content-Type':'application/json'};
const output='test-results/member-quota-stress.json',root='.local/member-quota-stress';
await mkdir(root,{recursive:true});await mkdir('test-results',{recursive:true});
async function api(path:string,body?:unknown){const r=await fetch(base+path,{headers,method:body?'POST':'GET',body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('Account API '+r.status);return r.json();}
const report:any=await readFile(output,'utf8').then(JSON.parse).catch(()=>({started:new Date().toISOString(),account:session.email,authorizedPoints:2000,refills:[],tasks:[],state:'running'}));
if(report.state==='completed'){console.log('Two quota cycles already completed; no model requests or quota resets sent.');process.exit(0);}
const save=async()=>{await writeFile(output+'.tmp',JSON.stringify(report,null,2));await rename(output+'.tmp',output);};
const quota=async()=>(await api('/v1/account/traffic/v2')).modelWeek;
async function refill(q:any){const request=randomUUID();await api('/v1/account/model-refill',{request,quote:q.quote});report.refills.push({request,price:q.price,before:q,after:await quota()});await save();}
if(!report.refills.length){report.before=await quota();if(report.before.balance<1176)throw Error('Need the authorized test credit before two fresh cycles');await refill(report.before);}
const models=(await api('/v1/models')).models.filter((m:any)=>m.id.startsWith('pool-'));
const adapter=knowledgeAdapter(root+'/knowledge');
const codec={encrypt:async(s:string)=>Buffer.from(s).toString('base64'),decrypt:async(s:string)=>Buffer.from(s,'base64').toString()};
// The isolated vault contains only synthetic tasks. Credentials stay in memory.
let round=Math.min(2,report.refills.length||1),seq=report.tasks.length,failures=0;
while(round<=2&&seq<1000){
 const before=await quota();
 if(before.remainingYuan<=0&&!before.quote){await new Promise(r=>setTimeout(r,2000));continue;}
 if(before.remainingYuan<=0){
  const rejected=await fetch(base+'/v1/models/chat/completions',{method:'POST',headers,body:JSON.stringify({model:models[0].id,stream:true,max_tokens:1,messages:[{role:'user',content:'额度边界检查'}]}),signal:AbortSignal.timeout(30000)});
  const detail=await rejected.json();const after=await quota();
  const boundary={status:rejected.status,error:detail.error,unchanged:after.remainingYuan===before.remainingYuan&&after.balance===before.balance};
  report['round'+round]={completed:true,quota:before,boundary};await save();
  if(rejected.status!==429||!boundary.unchanged){report.state='quota-boundary-failed';break;}
  if(round===2)break;await refill(before);round++;continue;
 }
 if(before.remainingYuan<0.05){
  // Exercise the final reservation boundary with small genuine requests; do not
  // fabricate usage or reset while spendable quota remains.
  const model=models.find((m:any)=>m.name.startsWith(before.remainingYuan<=0.0002?'mimo-v2.6-flash':before.remainingYuan<0.005?'deepseek-v4-flash':'kimi-k3.1-pro'))??models[0];
  const item:any={round,before,model:model.name,started:new Date().toISOString()};
  try{const answer=await requestAiReply(base+'/v1/models/chat/completions',{method:'POST',headers,body:JSON.stringify({model:model.id,stream:true,max_tokens:before.remainingYuan<=0.0002?4096:before.remainingYuan<0.002?16:256,messages:[{role:'user',content:'计算 137 + 286，只返回答案。'}]})},AbortSignal.timeout(180000),()=>{},undefined,fetch,usage=>{item.usage=usage;});item.answer=answer.content;item.correct=answer.content?.trim()==='423';}catch(e){item.error=String(e);}
  await new Promise(r=>setTimeout(r,/429/.test(item.error??'')?30000:2000));item.after=await quota();(report.tailChecks??=[]).push(item);await save();console.log(JSON.stringify({tail:true,round,remaining:item.after.remainingYuan,error:item.error}));
  if(report.tailChecks.filter((x:any)=>x.round===round).length>=100){report.state='quota-boundary-needs-review';break;}continue;
 }
 const model=models[seq%models.length],id='stress-'+(++seq),rows:any[]=[],expected:Record<string,number>={};
 // Deterministic but varied ledger reconciliation: duplicate IDs and signed refunds.
 for(let n=0;n<(before.remainingYuan<0.05?12:120);n++){const account='customer-'+(n%7),cents=((n*137+seq*53)%997)+1,amount=n%9===0?-cents:cents;const row={id:id+'-'+n,account,cents:amount};rows.push(row);if(n%11===0)rows.push({...row});expected[account]=(expected[account]??0)+amount;}
 let verified=false,submits=0;
 const record:any={id,round,model:model.name,started:new Date().toISOString(),before,calls:[],submissions:[]};
 const tools:any[]=[{id:'case_read',toolId:'case_read',packageId:'test.ledger',description:'读取本次合成订单账本。每个 id 只计一次，cents 为正向充值或负向退款，以整数分按 account 汇总。',inputSchema:{type:'object',properties:{},additionalProperties:false},outputSchema:{type:'object'},permissions:['test.read'],sideEffect:false},{id:'solution_submit',toolId:'solution_submit',packageId:'test.ledger',description:'提交 totals 对象，键为 account，值为去重后的整数分净额；返回验证结果。失败可读取反馈后修正。',inputSchema:{type:'object',properties:{totals:{type:'object',additionalProperties:{type:'integer'}}},required:['totals'],additionalProperties:false},outputSchema:{type:'object'},permissions:['test.write'],sideEffect:true},...Object.entries(knowledgeInputs).filter(([k])=>['knowledge_put','knowledge_search'].includes(k)).map(([k,s])=>({id:k,toolId:k,packageId:'cagent.knowledge',description:k,inputSchema:z.toJSONSchema(s),outputSchema:{type:'object'},permissions:['test.memory'],sideEffect:k==='knowledge_put'}))];
 tools.push({id:'ledger_aggregate',toolId:'ledger_aggregate',packageId:'test.ledger',description:'对 case_read 的全部数据进行精确整数聚合。distinctId 决定是否按 id 去重，signed 决定退款是否按负数计算。返回每个 account 的 totals。',inputSchema:{type:'object',properties:{distinctId:{type:'boolean'},signed:{type:'boolean'}},required:['distinctId','signed'],additionalProperties:false},outputSchema:{type:'object'},permissions:['test.read'],sideEffect:false});
 const assistant=new CagentAssistant(new ClientVault(root+'/'+id,codec),{shells:async()=>[],applications:async()=>[],execute:async()=>{throw Error('No host execution in ledger benchmark');},allowed:()=>true,capabilityTools:()=>tools,capabilityInvoke:async(input:any,signal,owner)=>{
  if(input.packageId==='cagent.knowledge')return adapter.invoke(input.toolId,input.args,owner,signal);
  if(input.toolId==='case_read')return {case:id,rows,rules:'按 id 去重；退款为负数；按 account 求和，不使用浮点货币。'};
  if(input.toolId==='ledger_aggregate'){const seen=new Set<string>(),totals:Record<string,number>={};for(const row of rows){if(input.args.distinctId&&seen.has(row.id))continue;seen.add(row.id);totals[row.account]=(totals[row.account]??0)+(input.args.signed?row.cents:Math.abs(row.cents));}return {totals};}
  if(input.toolId==='solution_submit'){submits++;const actual=input.args?.totals??{};const wrong=Object.keys(expected).filter(k=>actual[k]!==expected[k]);verified=wrong.length===0&&Object.keys(actual).length===Object.keys(expected).length;record.submissions.push({pass:verified,wrong,totals:actual});return {pass:verified,wrong,attempt:submits};}
  throw Error('Unknown test tool');
 }},async(url,init,signal,onContent,limits,transport)=>{
  const started=Date.now(),call:any={started:new Date().toISOString(),updates:0};record.calls.push(call);
  const capture:typeof fetch=async(u,i)=>{const response=await (transport??fetch)(u,i);const copy=response.clone(),index=record.calls.length;void copy.text().then(async raw=>{if(response.status===429){try{call.rejection=JSON.parse(raw).error;}catch{}}await writeFile(root+'/'+id+'-call-'+index+'.sse',raw);}).catch(()=>{});return response;};
  try{return await requestAiReply(url,init,signal,text=>{call.updates++;call.firstTextMs??=Date.now()-started;onContent(text);},limits,capture,usage=>{call.usage=usage;});}
  catch(e){call.error=String(e);throw e;}finally{call.elapsedMs=Date.now()-started;}
 });
 assistant.officialCredential=()=>session.token;
 try{
  await assistant.load();await assistant.configure({endpoint:base+'/v1/models/chat/completions',model:model.id,key:'',commands:false,review:false,delegates:[],runMinutes:8});
  const task=await assistant.start({requestId:randomUUID(),prompt:`这是 ${id} 的真实智能体稳定性测试。只使用合成测试工具，不能修改真实业务。先搜索知识库 experience，key ledger，查询 去重退款。调用 case_read，仔细逐条计算并提交 solution_submit，直到验证通过（最多三次）。通过后把验证方法与结果存入知识库 experience/key ledger（procedure），再用中文简述结果。不能未经 submit 验证就声称完成。`},'local');
  const deadline=Date.now()+510000;
  while(['running','approval'].includes(assistant.get(task,'local').state)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,500));
  const result=assistant.get(task,'local');record.state=result.state;record.answer=result.answer;record.error=result.error;record.events=result.events;record.pass=result.state==='completed'&&verified;
 }catch(e){record.error=String(e);record.pass=false;}finally{await assistant.close();}
 record.after=await quota();record.quotaDeltaYuan=Number((before.remainingYuan-record.after.remainingYuan).toFixed(6));record.finished=new Date().toISOString();report.tasks.push(record);report.round=round;await save();
 console.log(JSON.stringify({id,round,model:model.name,pass:record.pass,calls:record.calls.length,remaining:record.after.remainingYuan,error:record.error}));
 if(/HTTP 429/.test(record.error??'')){const reason=String(record.calls.at(-1)?.rejection??'');record.category=reason.includes('额度')?'quota-limit':reason.includes('正在处理')?'account-concurrency':'rate-limit';await save();await new Promise(r=>setTimeout(r,30000));continue;}
 if(/长度上限/.test(record.error??''))await new Promise(r=>setTimeout(r,30000));
 failures=record.pass?0:failures+1;
 if(failures>=models.length*2){report.state='blocked-after-two-catalog-cycles';break;}
}
report.after=await quota();report.finished=new Date().toISOString();if(report.state==='running')report.state=report.round2?.completed?'completed':'bounded-stop';await save();
console.log(JSON.stringify({state:report.state,tasks:report.tasks.length,after:report.after}));
