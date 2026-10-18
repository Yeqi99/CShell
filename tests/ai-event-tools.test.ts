import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {aiEventTools} from '../src/core/ai-event-tools';
import type {AiEventRule} from '../src/shared/ai-events';

test('event tools create, list, pause, resume, delete and reject stale mutations',async()=>{
 let rules:AiEventRule[]=[];const threadId=randomUUID();
 const host={snapshot:()=>({rules:structuredClone(rules)}),save:async(rule:AiEventRule)=>{rules=[...rules.filter(r=>r.id!==rule.id),rule];return rule;},remove:async(id:string)=>{rules=rules.filter(r=>r.id!==id);}};
 const get=(name:string)=>aiEventTools(host,threadId).find(t=>t.name===name)!;
 const invoke=async(name:string,args:unknown)=>{const tool=get(name);assert.equal(tool.capability,'events.manage');return JSON.parse(await tool.invoke(tool.input.parse(args),new AbortController().signal) as string);};
 const rule=await invoke('ai_event_save',{name:'test',source:'wechat',eventType:'message.received',prompt:'Summarize'});
 assert.equal(rule.threadId,threadId);assert.equal(rule.enabled,false);assert.equal(rule.cooldownSeconds,30);
 assert.equal((await invoke('ai_event_list',{})).rules.length,1);
 await invoke('ai_event_set_enabled',{id:rule.id,enabled:true});assert.equal(rules[0].enabled,true);
 const stale=get('ai_event_remove');await invoke('ai_event_set_enabled',{id:rule.id,enabled:false});
 await assert.rejects(()=>stale.invoke({id:rule.id},new AbortController().signal),/订阅已改变/);
 assert.throws(()=>get('ai_event_save').input.parse({name:'test',source:'wechat',eventType:'message.received',prompt:'x',bindingKey:'spoof'}));
 const controller=new AbortController();controller.abort();await assert.rejects(()=>get('ai_event_remove').invoke({id:rule.id},controller.signal));
 await invoke('ai_event_remove',{id:rule.id});assert.equal(rules.length,0);
});
