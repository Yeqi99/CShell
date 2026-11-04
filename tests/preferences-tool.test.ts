import test from 'node:test';import assert from 'node:assert/strict';
import {preferencesTool} from '../src/core/preferences-tool';import {defaults} from '../src/shared/contracts';
test('preferences tools keep sensitive configuration out, serialize revision writes and preserve omitted fields',async()=>{
 let saved={...defaults,uiFontAsset:null};let writes=0;
 const tool=preferencesTool({read:()=>saved,save:async value=>{writes++;saved=value;}});const signal=new AbortController().signal;
 const read=JSON.parse(await tool.invoke({action:'read'},signal));assert(!('uiFontAsset' in read.value));
 await assert.rejects(tool.invoke({action:'patch',revision:read.revision,changes:{mcp:{enabled:true}}},signal));
 const [a,b]=await Promise.allSettled([tool.invoke({action:'patch',revision:read.revision,changes:{theme:'dark',defaultConnectionView:'visual'}},signal),tool.invoke({action:'patch',revision:read.revision,changes:{theme:'light'}},signal)]);
 assert.equal(a.status,'fulfilled');assert.equal(b.status,'rejected');assert.equal(writes,1);assert.equal(saved.defaultConnectionView,'visual');assert.equal(saved.terminalFont,defaults.terminalFont);
 await assert.rejects(tool.invoke({action:'read'},signal,undefined,()=>{throw Error('revoked');}));
 assert.equal(tool.capability,'preferences.manage');assert(tool.needsReview({action:'patch',revision:read.revision,changes:{}}));
});
