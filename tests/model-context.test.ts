import assert from 'node:assert/strict';
import {test} from 'node:test';
import {modelContextWindow,contextInputLimit} from '../src/core/model-context';
import {compactContext} from '../src/core/agent-continuity';

test('capacity resolves per deployment including runtime overrides and unknown endpoints',()=>{
 const model='deepseek-v4-flash';
 assert.equal(modelContextWindow({model,url:'https://api.deepseek.com/v1'}),1048576);
 assert.equal(modelContextWindow({model,contextCatalog:'opencode'}),1000000);
 assert.equal(modelContextWindow({model,url:'https://example.com/v1',contextWindowTokens:8192}),8192);
 assert.equal(modelContextWindow({model,url:'https://example.com/v1'}),32768);
 const small={model,contextWindowTokens:8192};
 assert.ok(contextInputLimit(small,[],0)>contextInputLimit(small,[{description:'工具说明'}],1));
});
test('a large context keeps history, a smaller deployment summarizes without breaking tool pairs',async()=>{
 const history:any[]=[{role:'system',content:'rules'},{role:'system',content:'tools'},...Array.from({length:24},()=>({role:'user',content:'中'.repeat(5000)})),{role:'assistant',tool_calls:[{id:'a'}]},{role:'tool',tool_call_id:'a',content:'ok'},{role:'user',content:'继续'}];
 let saved=0;const save=async()=>{saved++};
 await compactContext(history,async()=>'摘要',save,{inputTokens:800000});assert.equal(saved,0);
 await compactContext(history,async()=>'摘要',save,{inputTokens:8192});assert.equal(saved,1);
 assert.deepEqual(history.slice(-3).map(m=>m.role),['assistant','tool','user']);
});
