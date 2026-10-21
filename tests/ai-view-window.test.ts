import test from 'node:test';
import assert from 'node:assert/strict';
import {openAiViewWindow} from '../src/ui/ai-view-window';
import type {AiThread} from '../src/shared/ai';
import {monitorViewSchema} from '../src/shared/monitor-views';
test('opening an AI view saves a reference to the existing conversation before opening its window',async()=>{
  const calls:unknown[]=[];
  const thread={id:'11111111-1111-4111-8111-111111111111',title:'Server A',sessionId:'bound-session',target:'Machine A'} as AiThread;
  (globalThis as any).window={cshell:{viewDisplays:async()=>[{id:'primary',primary:true}],saveMonitorView:async(v:unknown)=>{calls.push(monitorViewSchema.parse(v));},openMonitorView:async(id:string)=>{calls.push(id);}}};
  try {
    await openAiViewWindow(thread);
    const view=calls[0] as ReturnType<typeof monitorViewSchema.parse>;
    assert.equal(view.tiles[0].threadId,thread.id);
    assert.equal(view.tiles[0].profileId,'');
    assert.equal(view.tiles[0].kind,'ai');
    assert.equal(view.tiles[0].displayId,'primary');
    assert.equal(calls[1],view.id);
    assert.equal(thread.sessionId,'bound-session');
    assert.equal('messages' in view.tiles[0],false);
  }finally{delete (globalThis as any).window;}
});
