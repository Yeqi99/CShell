import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ProgressiveContext,describeTool,requireAdvertisedTools} from '../src/core/progressive-context';
import {compactContext} from '../src/core/agent-continuity';
import {logPreview} from '../src/core/tool-log-context';
const plugin=describeTool({function:{name:'inspect_board'}},{category:'electronics',purpose:'Read voltage',target:'bound machine'});
const file={function:{name:'file_read'}};
const calls=(name:string,args={})=>[{function:{name,arguments:JSON.stringify(args)}}];
test('discover a new package by metadata and require a fresh, entirely advertised batch',()=>{
 const context=new ProgressiveContext('fixture');
 const history=[{role:'user',content:'diagnose the issue'}];
 const prepare=()=>context.prepare(history,[plugin,file],true);
 const names=()=>prepare().tools.map(t=>t.function.name);
 assert.deepEqual(names(),['load_task_context']);
 assert.match(JSON.stringify(prepare().messages),/electronics.*bound machine.*Read voltage/);
 for(const group of ['typo','electronics','electronics']){
  assert.equal(context.expand(calls('load_task_context',{group}),prepare().tools),true);
  assert.ok(!names().includes('file_read'));
 }
 assert.ok(names().includes('inspect_board'));
 assert.throws(()=>requireAdvertisedTools([...calls('inspect_board'),...calls('file_read')],prepare().tools));
 assert.equal(context.expand(calls('file_read'),prepare().tools),true);
 requireAdvertisedTools(calls('file_read'),prepare().tools);
 const hello=new ProgressiveContext('fixture').prepare([{role:'user',content:'你好'}],[plugin],true);
 assert.throws(()=>requireAdvertisedTools(calls('inspect_board'),hello.tools));
 context.expand(calls('load_task_context',{group:'all'}),prepare().tools);
 assert.deepEqual(names(),['inspect_board','file_read']);
});
test('log pruning preserves recoverability, avoids an unnecessary summary and is atomic on save failure',async()=>{
 const log=logPreview('x'.repeat(9000),'00000000-0000-4000-8000-000000000001','execute_command','atlas',{command:'inspect'});
 const history=[{role:'system',content:'system'},{role:'tool',content:log},...Array.from({length:20},()=>({role:'user',content:'next step'}))];
 const initial=structuredClone(history);
 await assert.rejects(compactContext(history,async()=>'short',async()=>{throw Error('disk full')},300),/disk full/);
 assert.deepEqual(history,initial);
 await compactContext(history,async()=>assert.fail('unnecessary summary'),async()=>{},1200);
 assert.deepEqual(JSON.parse(history[1].content).task_log_read,{id:'00000000-0000-4000-8000-000000000001',offset:0});
});
