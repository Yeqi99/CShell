import test from 'node:test';
import assert from 'node:assert/strict';
import { assertMonitorAiRequest, monitorOwnsAi } from '../src/shared/monitor-ai-access';
import type { ViewTile } from '../src/shared/monitor-views';
const tiles=[{kind:'ai',threadId:'selected-thread'},{kind:'ssh',threadId:'not-ai-thread'}] as ViewTile[];
test('view AI scope excludes other windows, unrelated histories and removed panes',()=>{
  const created=new Set(['own-analysis']);
  assert.ok(monitorOwnsAi(tiles,created,'selected-thread'));
  assert.ok(monitorOwnsAi(tiles,created,'own-analysis'));
  for(const id of ['other-window-analysis','not-ai-thread',undefined,{}])assert.equal(monitorOwnsAi(tiles,created,id),false);
  assert.equal(monitorOwnsAi([],created,'selected-thread'),false);
  for(const channel of ['ai:send','ai:stop','ai:approve','ai:mode']){
    assert.doesNotThrow(()=>assertMonitorAiRequest(channel,['own-analysis'],tiles,created,new Map()));
    assert.throws(()=>assertMonitorAiRequest(channel,['other-window-analysis'],tiles,created,new Map()));
  }
});
test('terminal AI creation cannot bind the main window session or a desktop target',()=>{
  const sessions=new Map([['owned-terminal',()=>{}]]);
  assert.doesNotThrow(()=>assertMonitorAiRequest('ai:create',['terminal','provider','review','owned-terminal'],tiles,undefined,sessions));
  for(const session of [undefined,'main-terminal','desktop-target'])assert.throws(()=>assertMonitorAiRequest('ai:create',['terminal','provider','review',session],tiles,undefined,sessions));
  assert.throws(()=>assertMonitorAiRequest('ai:create',['files','provider','review','owned-terminal'],tiles,undefined,sessions));
  sessions.clear();assert.throws(()=>assertMonitorAiRequest('ai:create',['terminal','provider','review','owned-terminal'],tiles,undefined,sessions));
});
