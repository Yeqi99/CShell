import {test} from 'node:test';
import assert from 'node:assert/strict';
import {feedbackDiagnostic,feedbackSchema,redactFeedback} from '../src/shared/feedback';
import {submitFeedback} from '../src/shared/feedback-submit';
const data={id:'ec216ec8-ea94-4b49-b6c7-89114b9fef31',message:'broken password=secret',version:'1.0.0',platform:'win32'};
test('feedback excludes raw diagnostics and redacts common credentials',()=>{
 assert.equal(feedbackDiagnostic('ETIMEDOUT https://user:pass@host 192.168.1.2 HTTP 401'), 'ETIMEDOUT\nHTTP 401');
 for(const value of ['password=topsecret','{"token":"topsecret"}','https://user:topsecret@host','Bearer topsecret'])assert.ok(!redactFeedback(value).includes('topsecret'));
 assert.throws(()=>feedbackSchema.parse({...data,connections:[]}));assert.throws(()=>feedbackSchema.parse({...data,message:'a'.repeat(6001)}));
});
test('anonymous feedback sends exact receipt-bound request without auth and rejects missing receipt',async()=>{
 const fake=async(url:string,init?:RequestInit)=>{assert.equal(url,'https://shell.canp.ai/api/v1/feedback');assert.equal(init?.credentials,'omit');assert.equal(init?.redirect,'error');assert.deepEqual(init?.headers,{'Content-Type':'application/json'});assert.ok(!String(init?.body).includes('=secret'));return Response.json({received:true,id:data.id});};
 assert.deepEqual(await submitFeedback(data,fake),{ok:true,id:data.id});
 await assert.rejects(()=>submitFeedback(data,async()=>Response.json({ok:true})));
 await assert.rejects(()=>submitFeedback(data,async()=>new Response('',{status:429})),/频繁/);
});
