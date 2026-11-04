import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {AiService} from '../src/core/ai';

test('switching model preserves conversation history and rejects active turns',async()=>{
 const first=randomUUID(),second=randomUUID(),id=randomUUID();
 const thread={id,providerId:first,messages:[{role:'user',content:'keep me'}],mode:'all',state:'idle'};
 const service=Object.create(AiService.prototype) as any;
 service.threads=[thread];service.providers=[{id:first},{id:second}];service.runs=new Map();let saves=0;
 service.persist=async()=>{saves++};
 service.runs.set(id,{});
 await assert.rejects(service.changeThreadProvider(id,second),/等待/);
 assert.equal(thread.providerId,first);assert.equal(saves,0);
 service.runs.clear();await service.changeThreadProvider(id,second);
 assert.equal(thread.providerId,second);assert.deepEqual(thread.messages,[{role:'user',content:'keep me'}]);assert.equal(thread.mode,'all');assert.equal(saves,1);
});

test('extension validation cannot race a new running turn',async()=>{
 const id=randomUUID(),first=randomUUID(),second=randomUUID();
 const thread={id,providerId:first,messages:[],state:'idle'};
 const service=Object.create(AiService.prototype) as any;
 service.threads=[thread];service.providers=[{id:first},{id:second,extension:{id:'cshell.opencode',model:'fixture'}}];service.runs=new Map();service.persist=async()=>assert.fail('should not persist');
 service.providerExtensions={resolve:async()=>{service.runs.set(id,{})}};
 await assert.rejects(service.changeThreadProvider(id,second),/状态已变化/);assert.equal(thread.providerId,first);
});
